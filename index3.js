
let obj = {
  value: 10,
  getValue: function () {
    return this.value;
  },
};

let getValue = obj.getValue;
console.log(getValue())