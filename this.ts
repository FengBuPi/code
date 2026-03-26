const json = `
{
  "name": "",
  "age": 18,
  "gender": "男",
  "address": "北京",
  "phone": "12345678901",
  "email": "zhangsan@example.com"
}
`;
const obj: User = JSON.parse(json);
console.log(obj.name);

interface User {
  name: string;
  age: number;
  gender: string;
  address: string;
  phone: string;
  email: string;
}
