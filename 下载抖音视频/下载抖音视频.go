package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"net/http"
	urlpkg "net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL  = "https://www.douyin.com"
	defaultReferer  = "https://www.douyin.com/"
	defaultTimeout  = 30 * time.Second
	resourceVideo   = "video"
	resourceNote    = "note"
	renderDataStart = `<script id="RENDER_DATA" type="application/json">`
	renderDataEnd   = `</script>`
)

var (
	errEmptyInput        = errors.New("douyin input is empty")
	errAwemeIDNotFound   = errors.New("douyin aweme_id not found")
	errRenderDataMissing = errors.New("douyin render data not found")
	errVideoURLMissing   = errors.New("douyin video url not found")

	sharePathPattern = regexp.MustCompile(`/((?:video)|(?:note))/([0-9]+)`)
	quotedJSONRegexp = regexp.MustCompile(`"([^"]*?(?:playAddr|searchProps|app)[^"]*?)"`)
	urlExtractRegexp = regexp.MustCompile(`https?://[^\s]+`)
	digitsRegexp     = regexp.MustCompile(`^\d+$`)
)

type resolveResult struct {
	SourceInput    string
	FinalShareURL  string
	NormalizedURL  string
	ResourceType   string
	AwemeID        string
	Title          string
	CoverURL       string
	DownloadURL    string
	DownloadHeader map[string]string
}

type client struct {
	httpClient *http.Client
	baseURL    string
	referer    string
}

func main() {
	var (
		inputArg   string
		outputArg  string
		timeoutArg time.Duration
	)
	flag.StringVar(&inputArg, "input", "", "Douyin share URL, media URL, or aweme id")
	flag.StringVar(&outputArg, "out", "", "Save path or directory; defaults to current directory")
	flag.DurationVar(&timeoutArg, "timeout", defaultTimeout, "HTTP timeout, e.g. 30s")
	flag.Parse()

	if strings.TrimSpace(inputArg) == "" && flag.NArg() > 0 {
		inputArg = flag.Arg(0)
	}
	if strings.TrimSpace(outputArg) == "" && flag.NArg() > 1 {
		outputArg = flag.Arg(1)
	}

	reader := bufio.NewReader(os.Stdin)
	if strings.TrimSpace(inputArg) == "" {
		var err error
		inputArg, err = prompt(reader, "请输入抖音链接或视频ID")
		if err != nil {
			exitf("读取输入失败: %v\n", err)
		}
	}
	if strings.TrimSpace(outputArg) == "" {
		var err error
		outputArg, err = prompt(reader, "请输入保存路径(留空默认当前目录)")
		if err != nil {
			exitf("读取保存路径失败: %v\n", err)
		}
	}

	c := &client{
		httpClient: &http.Client{Timeout: timeoutArg},
		baseURL:    defaultBaseURL,
		referer:    defaultReferer,
	}
	ctx := context.Background()

	result, err := c.resolve(ctx, inputArg)
	if err != nil {
		exitf("解析失败: %v\n", err)
	}

	savePath, err := buildSavePath(result, outputArg)
	if err != nil {
		exitf("处理保存路径失败: %v\n", err)
	}

	fmt.Printf("标题: %s\n", fallbackText(result.Title, "(无标题)"))
	fmt.Printf("ID: %s\n", fallbackText(result.AwemeID, "(未知)"))
	fmt.Printf("类型: %s\n", fallbackText(result.ResourceType, resourceVideo))
	fmt.Printf("下载地址: %s\n", result.DownloadURL)
	fmt.Printf("保存到: %s\n", savePath)

	size, contentType, err := c.downloadToPath(ctx, result.DownloadURL, result.DownloadHeader, savePath)
	if err != nil {
		exitf("下载失败: %v\n", err)
	}

	fmt.Printf("下载完成: %s (%s, %s)\n", savePath, humanBytes(size), contentType)
}

func prompt(reader *bufio.Reader, label string) (string, error) {
	fmt.Printf("%s: ", label)
	text, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	return strings.TrimSpace(text), nil
}

func exitf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format, args...)
	os.Exit(1)
}

func (c *client) resolve(ctx context.Context, rawInput string) (*resolveResult, error) {
	input := normalizeInput(rawInput)
	if input == "" {
		return nil, errEmptyInput
	}

	if looksLikeMediaURL(input) {
		return &resolveResult{
			SourceInput:    rawInput,
			FinalShareURL:  input,
			DownloadURL:    input,
			ResourceType:   resourceVideo,
			DownloadHeader: buildDownloadHeaders(c.referer, ""),
		}, nil
	}

	finalShareURL := input
	awemeID, resourceType, normalizedURL := extractAwemeIDFromInput(input, c.baseURL)
	if awemeID == "" {
		redirectedURL, err := c.resolveRedirectURL(ctx, input)
		if err != nil {
			return nil, err
		}
		finalShareURL = redirectedURL
		awemeID, resourceType, normalizedURL = extractAwemeIDFromInput(redirectedURL, c.baseURL)
		if awemeID == "" {
			return nil, fmt.Errorf("%w: %s", errAwemeIDNotFound, rawInput)
		}
	}

	html, err := c.fetchJingxuanHTML(ctx, awemeID)
	if err != nil {
		return nil, err
	}
	renderDataEncoded, err := extractRenderDataEncoded(html)
	if err != nil {
		return nil, err
	}
	renderData, err := urlpkg.PathUnescape(renderDataEncoded)
	if err != nil {
		return nil, fmt.Errorf("decode render data failed: %w", err)
	}

	result, err := buildResolveResult(renderData)
	if err != nil {
		return nil, err
	}
	result.SourceInput = rawInput
	result.FinalShareURL = finalShareURL
	result.NormalizedURL = normalizedURL
	result.ResourceType = firstNonEmpty(result.ResourceType, resourceType, resourceVideo)
	result.AwemeID = awemeID
	result.DownloadHeader = buildDownloadHeaders(c.referer, normalizedURL)
	return result, nil
}

func normalizeInput(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	if matches := urlExtractRegexp.FindString(text); matches != "" {
		return strings.TrimRight(matches, ".,;)")
	}
	if digitsRegexp.MatchString(text) {
		return text
	}
	return text
}

func extractAwemeIDFromInput(rawInput, baseURL string) (awemeID, resourceType, normalizedURL string) {
	clean := strings.TrimSpace(rawInput)
	if digitsRegexp.MatchString(clean) {
		return clean, resourceVideo, strings.TrimRight(baseURL, "/") + "/video/" + clean
	}

	u, err := urlpkg.Parse(clean)
	if err != nil {
		return "", "", ""
	}

	if modalID := strings.TrimSpace(u.Query().Get("modal_id")); modalID != "" {
		return modalID, resourceVideo, strings.TrimRight(baseURL, "/") + "/video/" + modalID
	}

	matches := sharePathPattern.FindStringSubmatch(u.Path)
	if len(matches) != 3 {
		return "", "", ""
	}
	resourceType = matches[1]
	awemeID = matches[2]
	normalizedURL = strings.TrimRight(baseURL, "/") + "/" + resourceType + "/" + awemeID
	return awemeID, resourceType, normalizedURL
}

func (c *client) resolveRedirectURL(ctx context.Context, rawURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	setCommonHeaders(req.Header, c.referer)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.Request == nil || resp.Request.URL == nil {
		return "", fmt.Errorf("%w: %s", errAwemeIDNotFound, rawURL)
	}
	return resp.Request.URL.String(), nil
}

func (c *client) fetchJingxuanHTML(ctx context.Context, awemeID string) (string, error) {
	requestURL := fmt.Sprintf("%s/jingxuan?modal_id=%s", c.baseURL, awemeID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return "", err
	}
	setCommonHeaders(req.Header, c.referer)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("request douyin jingxuan status=%d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func extractRenderDataEncoded(html string) (string, error) {
	start := strings.Index(html, renderDataStart)
	if start >= 0 {
		start += len(renderDataStart)
		end := strings.Index(html[start:], renderDataEnd)
		if end >= 0 {
			return html[start : start+end], nil
		}
	}

	matches := quotedJSONRegexp.FindAllStringSubmatch(html, -1)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		candidate := match[1]
		if strings.Contains(candidate, "playAddr") && strings.Contains(candidate, "searchProps") && strings.Contains(candidate, "app") {
			return candidate, nil
		}
	}
	return "", errRenderDataMissing
}

func buildResolveResult(renderData string) (*resolveResult, error) {
	var payload any
	if err := json.Unmarshal([]byte(renderData), &payload); err != nil {
		return nil, fmt.Errorf("parse render data failed: %w", err)
	}

	resourceType := resourceVideo
	if hasValue(payload, "app.noteDetail") {
		resourceType = resourceNote
	}

	result := &resolveResult{
		ResourceType: resourceType,
		Title: firstJSONValue(payload,
			"app.videoDetail.desc",
			"app.noteDetail.desc",
		),
		CoverURL: firstJSONValue(payload,
			"app.videoDetail.video.cover.urlList.0",
			"app.videoDetail.video.dynamicCover.urlList.0",
			"app.videoDetail.video.originCover.urlList.0",
			"app.noteDetail.video.cover.urlList.0",
			"app.noteDetail.video.dynamicCover.urlList.0",
			"app.noteDetail.video.originCover.urlList.0",
		),
		DownloadURL: firstJSONValue(payload,
			"app.videoDetail.video.playAddr.0.src",
			"app.videoDetail.video.playAddr.1.src",
			"app.noteDetail.video.playAddr.0.src",
			"app.noteDetail.video.playAddr.1.src",
		),
	}
	if strings.TrimSpace(result.DownloadURL) == "" {
		return nil, errVideoURLMissing
	}
	return result, nil
}

func hasValue(payload any, path string) bool {
	_, ok := jsonPath(payload, path)
	return ok
}

func firstJSONValue(payload any, paths ...string) string {
	for _, path := range paths {
		value, ok := jsonPath(payload, path)
		if !ok {
			continue
		}
		switch v := value.(type) {
		case string:
			if strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		case float64:
			return strconv.FormatFloat(v, 'f', -1, 64)
		case bool:
			return strconv.FormatBool(v)
		}
	}
	return ""
}

func jsonPath(payload any, path string) (any, bool) {
	current := payload
	for _, part := range strings.Split(path, ".") {
		switch node := current.(type) {
		case map[string]any:
			next, ok := node[part]
			if !ok {
				return nil, false
			}
			current = next
		case []any:
			idx, err := strconv.Atoi(part)
			if err != nil || idx < 0 || idx >= len(node) {
				return nil, false
			}
			current = node[idx]
		default:
			return nil, false
		}
	}
	return current, true
}

func buildDownloadHeaders(defaultReferer, shareURL string) map[string]string {
	referer := strings.TrimSpace(shareURL)
	if referer == "" {
		referer = strings.TrimSpace(defaultReferer)
	}
	return map[string]string{
		"User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
		"Accept":          "*/*",
		"Accept-Encoding": "identity",
		"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
		"Cache-Control":   "no-cache",
		"Pragma":          "no-cache",
		"Connection":      "keep-alive",
		"Referer":         referer,
	}
}

func setCommonHeaders(headers http.Header, referer string) {
	for key, value := range buildDownloadHeaders(referer, "") {
		headers.Set(key, value)
	}
	headers.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
}

func looksLikeMediaURL(rawURL string) bool {
	u, err := urlpkg.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return false
	}
	for _, keyword := range []string{
		"douyinvod.com",
		"aweme.com",
		"amemv.com",
		"byteimg.com",
		"bdxiguaimg.com",
	} {
		if strings.Contains(host, keyword) {
			return true
		}
	}
	return false
}

func buildSavePath(result *resolveResult, output string) (string, error) {
	filename := defaultFilename(result)
	cleanOutput := strings.TrimSpace(output)
	if cleanOutput == "" {
		wd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		return filepath.Join(wd, filename), nil
	}

	if info, err := os.Stat(cleanOutput); err == nil && info.IsDir() {
		return filepath.Join(cleanOutput, filename), nil
	}
	if !strings.Contains(filepath.Base(cleanOutput), ".") {
		return filepath.Join(cleanOutput, filename), nil
	}
	if strings.HasSuffix(cleanOutput, string(os.PathSeparator)) || strings.HasSuffix(cleanOutput, "/") {
		return filepath.Join(cleanOutput, filename), nil
	}
	return cleanOutput, nil
}

func defaultFilename(result *resolveResult) string {
	base := sanitizeFilename(firstNonEmpty(result.Title, result.AwemeID, "douyin_video"))
	return base + ".mp4"
}

func sanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "douyin_video"
	}
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
		"\n", " ",
		"\r", " ",
		"\t", " ",
	)
	name = replacer.Replace(name)
	name = strings.Join(strings.Fields(name), " ")
	name = truncateRunes(name, 80)
	name = strings.Trim(name, " .")
	if name == "" {
		return "douyin_video"
	}
	return name
}

func truncateRunes(s string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	return string(runes[:limit])
}

func (c *client) downloadToPath(ctx context.Context, rawURL string, headers map[string]string, savePath string) (int64, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, "", err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return 0, "", fmt.Errorf("download douyin video status=%d", resp.StatusCode)
	}
	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if !isAcceptableVideoContentType(contentType) {
		return 0, contentType, fmt.Errorf("download douyin video invalid content_type=%s status=%d", contentType, resp.StatusCode)
	}

	if err := os.MkdirAll(filepath.Dir(savePath), 0o755); err != nil {
		return 0, "", err
	}

	tempPath := savePath + ".part"
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0o664)
	if err != nil {
		return 0, "", err
	}

	success := false
	defer file.Close()
	defer func() {
		if !success {
			_ = os.Remove(tempPath)
		}
	}()

	size, err := copyWithProgress(file, resp.Body, resp.ContentLength)
	if err != nil {
		return 0, "", err
	}
	if err := file.Close(); err != nil {
		return 0, "", err
	}
	if err := os.Rename(tempPath, savePath); err != nil {
		return 0, "", err
	}
	success = true
	return size, contentType, nil
}

func copyWithProgress(dst io.Writer, src io.Reader, total int64) (int64, error) {
	buf := make([]byte, 256*1024)
	var written int64
	start := time.Now()
	lastPrint := time.Time{}

	for {
		nr, er := src.Read(buf)
		if nr > 0 {
			nw, ew := dst.Write(buf[:nr])
			if nw > 0 {
				written += int64(nw)
			}
			if ew != nil {
				fmt.Println()
				return written, ew
			}
			if nw != nr {
				fmt.Println()
				return written, io.ErrShortWrite
			}
			now := time.Now()
			if lastPrint.IsZero() || now.Sub(lastPrint) >= 200*time.Millisecond {
				printProgress(written, total, start)
				lastPrint = now
			}
		}
		if er != nil {
			if errors.Is(er, io.EOF) {
				printProgress(written, total, start)
				fmt.Println()
				return written, nil
			}
			fmt.Println()
			return written, er
		}
	}
}

func printProgress(written, total int64, start time.Time) {
	elapsed := time.Since(start).Seconds()
	if elapsed <= 0 {
		elapsed = 1
	}
	speed := float64(written) / elapsed

	if total > 0 {
		percent := float64(written) / float64(total) * 100
		fmt.Printf("\r进度: %6.2f%%  %s / %s  速度: %s/s", percent, humanBytes(written), humanBytes(total), humanBytes(int64(speed)))
		return
	}
	fmt.Printf("\r已下载: %s  速度: %s/s", humanBytes(written), humanBytes(int64(speed)))
}

func isAcceptableVideoContentType(contentType string) bool {
	contentType = strings.TrimSpace(contentType)
	if contentType == "" {
		return true
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if strings.HasPrefix(mediaType, "video/") {
		return true
	}
	switch mediaType {
	case "application/octet-stream", "binary/octet-stream", "application/mp4":
		return true
	default:
		return false
	}
}

func humanBytes(n int64) string {
	size := float64(n)
	units := []string{"B", "KB", "MB", "GB", "TB"}
	unit := 0
	for size >= 1024 && unit < len(units)-1 {
		size /= 1024
		unit++
	}
	if unit == 0 {
		return fmt.Sprintf("%d %s", n, units[unit])
	}
	return fmt.Sprintf("%.2f %s", size, units[unit])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func fallbackText(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
