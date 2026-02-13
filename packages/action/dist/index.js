var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/collect.js/dist/methods/symbol.iterator.js
var require_symbol_iterator = __commonJS({
  "../../node_modules/collect.js/dist/methods/symbol.iterator.js"(exports, module) {
    "use strict";
    module.exports = function SymbolIterator() {
      var _this = this;
      var index = -1;
      return {
        next: function next() {
          index += 1;
          return {
            value: _this.items[index],
            done: index >= _this.items.length
          };
        }
      };
    };
  }
});

// ../../node_modules/collect.js/dist/methods/all.js
var require_all = __commonJS({
  "../../node_modules/collect.js/dist/methods/all.js"(exports, module) {
    "use strict";
    module.exports = function all() {
      return this.items;
    };
  }
});

// ../../node_modules/collect.js/dist/helpers/is.js
var require_is = __commonJS({
  "../../node_modules/collect.js/dist/helpers/is.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    module.exports = {
      /**
       * @returns {boolean}
       */
      isArray: function isArray(item) {
        return Array.isArray(item);
      },
      /**
       * @returns {boolean}
       */
      isObject: function isObject(item) {
        return _typeof(item) === "object" && Array.isArray(item) === false && item !== null;
      },
      /**
       * @returns {boolean}
       */
      isFunction: function isFunction(item) {
        return typeof item === "function";
      }
    };
  }
});

// ../../node_modules/collect.js/dist/methods/average.js
var require_average = __commonJS({
  "../../node_modules/collect.js/dist/methods/average.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function average(key) {
      if (key === void 0) {
        return this.sum() / this.items.length;
      }
      if (isFunction(key)) {
        return new this.constructor(this.items).sum(key) / this.items.length;
      }
      return new this.constructor(this.items).pluck(key).sum() / this.items.length;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/avg.js
var require_avg = __commonJS({
  "../../node_modules/collect.js/dist/methods/avg.js"(exports, module) {
    "use strict";
    var average = require_average();
    module.exports = average;
  }
});

// ../../node_modules/collect.js/dist/methods/chunk.js
var require_chunk = __commonJS({
  "../../node_modules/collect.js/dist/methods/chunk.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    module.exports = function chunk(size) {
      var _this = this;
      var chunks = [];
      var index = 0;
      if (Array.isArray(this.items)) {
        do {
          var items = this.items.slice(index, index + size);
          var collection = new this.constructor(items);
          chunks.push(collection);
          index += size;
        } while (index < this.items.length);
      } else if (_typeof(this.items) === "object") {
        var keys = Object.keys(this.items);
        var _loop = function _loop2() {
          var keysOfChunk = keys.slice(index, index + size);
          var collection2 = new _this.constructor({});
          keysOfChunk.forEach(function(key) {
            return collection2.put(key, _this.items[key]);
          });
          chunks.push(collection2);
          index += size;
        };
        do {
          _loop();
        } while (index < keys.length);
      } else {
        chunks.push(new this.constructor([this.items]));
      }
      return new this.constructor(chunks);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/collapse.js
var require_collapse = __commonJS({
  "../../node_modules/collect.js/dist/methods/collapse.js"(exports, module) {
    "use strict";
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    module.exports = function collapse() {
      var _ref;
      return new this.constructor((_ref = []).concat.apply(_ref, _toConsumableArray(this.items)));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/combine.js
var require_combine = __commonJS({
  "../../node_modules/collect.js/dist/methods/combine.js"(exports, module) {
    "use strict";
    function _slicedToArray(arr, i) {
      return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest();
    }
    function _nonIterableRest() {
      throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    function _iterableToArrayLimit(arr, i) {
      var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"];
      if (_i == null) return;
      var _arr = [];
      var _n = true;
      var _d = false;
      var _s, _e;
      try {
        for (_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true) {
          _arr.push(_s.value);
          if (i && _arr.length === i) break;
        }
      } catch (err) {
        _d = true;
        _e = err;
      } finally {
        try {
          if (!_n && _i["return"] != null) _i["return"]();
        } finally {
          if (_d) throw _e;
        }
      }
      return _arr;
    }
    function _arrayWithHoles(arr) {
      if (Array.isArray(arr)) return arr;
    }
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    module.exports = function combine(array) {
      var _this = this;
      var values = array;
      if (values instanceof this.constructor) {
        values = array.all();
      }
      var collection = {};
      if (Array.isArray(this.items) && Array.isArray(values)) {
        this.items.forEach(function(key, iterator) {
          collection[key] = values[iterator];
        });
      } else if (_typeof(this.items) === "object" && _typeof(values) === "object") {
        Object.keys(this.items).forEach(function(key, index) {
          collection[_this.items[key]] = values[Object.keys(values)[index]];
        });
      } else if (Array.isArray(this.items)) {
        collection[this.items[0]] = values;
      } else if (typeof this.items === "string" && Array.isArray(values)) {
        var _values = values;
        var _values2 = _slicedToArray(_values, 1);
        collection[this.items] = _values2[0];
      } else if (typeof this.items === "string") {
        collection[this.items] = values;
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/helpers/clone.js
var require_clone = __commonJS({
  "../../node_modules/collect.js/dist/helpers/clone.js"(exports, module) {
    "use strict";
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    module.exports = function clone(items) {
      var cloned;
      if (Array.isArray(items)) {
        var _cloned;
        cloned = [];
        (_cloned = cloned).push.apply(_cloned, _toConsumableArray(items));
      } else {
        cloned = {};
        Object.keys(items).forEach(function(prop) {
          cloned[prop] = items[prop];
        });
      }
      return cloned;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/concat.js
var require_concat = __commonJS({
  "../../node_modules/collect.js/dist/methods/concat.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    var clone = require_clone();
    module.exports = function concat(collectionOrArrayOrObject) {
      var list = collectionOrArrayOrObject;
      if (collectionOrArrayOrObject instanceof this.constructor) {
        list = collectionOrArrayOrObject.all();
      } else if (_typeof(collectionOrArrayOrObject) === "object") {
        list = [];
        Object.keys(collectionOrArrayOrObject).forEach(function(property) {
          list.push(collectionOrArrayOrObject[property]);
        });
      }
      var collection = clone(this.items);
      list.forEach(function(item) {
        if (_typeof(item) === "object") {
          Object.keys(item).forEach(function(key) {
            return collection.push(item[key]);
          });
        } else {
          collection.push(item);
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/helpers/values.js
var require_values = __commonJS({
  "../../node_modules/collect.js/dist/helpers/values.js"(exports, module) {
    "use strict";
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    module.exports = function values(items) {
      var valuesArray = [];
      if (Array.isArray(items)) {
        valuesArray.push.apply(valuesArray, _toConsumableArray(items));
      } else if (items.constructor.name === "Collection") {
        valuesArray.push.apply(valuesArray, _toConsumableArray(items.all()));
      } else {
        Object.keys(items).forEach(function(prop) {
          return valuesArray.push(items[prop]);
        });
      }
      return valuesArray;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/contains.js
var require_contains = __commonJS({
  "../../node_modules/collect.js/dist/methods/contains.js"(exports, module) {
    "use strict";
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    var values = require_values();
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function contains(key, value) {
      if (value !== void 0) {
        if (Array.isArray(this.items)) {
          return this.items.filter(function(items) {
            return items[key] !== void 0 && items[key] === value;
          }).length > 0;
        }
        return this.items[key] !== void 0 && this.items[key] === value;
      }
      if (isFunction(key)) {
        return this.items.filter(function(item, index) {
          return key(item, index);
        }).length > 0;
      }
      if (Array.isArray(this.items)) {
        return this.items.indexOf(key) !== -1;
      }
      var keysAndValues = values(this.items);
      keysAndValues.push.apply(keysAndValues, _toConsumableArray(Object.keys(this.items)));
      return keysAndValues.indexOf(key) !== -1;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/containsOneItem.js
var require_containsOneItem = __commonJS({
  "../../node_modules/collect.js/dist/methods/containsOneItem.js"(exports, module) {
    "use strict";
    module.exports = function containsOneItem() {
      return this.count() === 1;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/count.js
var require_count = __commonJS({
  "../../node_modules/collect.js/dist/methods/count.js"(exports, module) {
    "use strict";
    module.exports = function count() {
      var arrayLength = 0;
      if (Array.isArray(this.items)) {
        arrayLength = this.items.length;
      }
      return Math.max(Object.keys(this.items).length, arrayLength);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/countBy.js
var require_countBy = __commonJS({
  "../../node_modules/collect.js/dist/methods/countBy.js"(exports, module) {
    "use strict";
    module.exports = function countBy() {
      var fn = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : function(value) {
        return value;
      };
      return new this.constructor(this.items).groupBy(fn).map(function(value) {
        return value.count();
      });
    };
  }
});

// ../../node_modules/collect.js/dist/methods/crossJoin.js
var require_crossJoin = __commonJS({
  "../../node_modules/collect.js/dist/methods/crossJoin.js"(exports, module) {
    "use strict";
    module.exports = function crossJoin() {
      function join(collection, constructor, args) {
        var current = args[0];
        if (current instanceof constructor) {
          current = current.all();
        }
        var rest = args.slice(1);
        var last = !rest.length;
        var result = [];
        for (var i = 0; i < current.length; i += 1) {
          var collectionCopy = collection.slice();
          collectionCopy.push(current[i]);
          if (last) {
            result.push(collectionCopy);
          } else {
            result = result.concat(join(collectionCopy, constructor, rest));
          }
        }
        return result;
      }
      for (var _len = arguments.length, values = new Array(_len), _key = 0; _key < _len; _key++) {
        values[_key] = arguments[_key];
      }
      return new this.constructor(join([], this.constructor, [].concat([this.items], values)));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/dd.js
var require_dd = __commonJS({
  "../../node_modules/collect.js/dist/methods/dd.js"(exports, module) {
    "use strict";
    module.exports = function dd() {
      this.dump();
      if (typeof process !== "undefined") {
        process.exit(1);
      }
    };
  }
});

// ../../node_modules/collect.js/dist/methods/diff.js
var require_diff = __commonJS({
  "../../node_modules/collect.js/dist/methods/diff.js"(exports, module) {
    "use strict";
    module.exports = function diff(values) {
      var valuesToDiff;
      if (values instanceof this.constructor) {
        valuesToDiff = values.all();
      } else {
        valuesToDiff = values;
      }
      var collection = this.items.filter(function(item) {
        return valuesToDiff.indexOf(item) === -1;
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/diffAssoc.js
var require_diffAssoc = __commonJS({
  "../../node_modules/collect.js/dist/methods/diffAssoc.js"(exports, module) {
    "use strict";
    module.exports = function diffAssoc(values) {
      var _this = this;
      var diffValues = values;
      if (values instanceof this.constructor) {
        diffValues = values.all();
      }
      var collection = {};
      Object.keys(this.items).forEach(function(key) {
        if (diffValues[key] === void 0 || diffValues[key] !== _this.items[key]) {
          collection[key] = _this.items[key];
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/diffKeys.js
var require_diffKeys = __commonJS({
  "../../node_modules/collect.js/dist/methods/diffKeys.js"(exports, module) {
    "use strict";
    module.exports = function diffKeys(object) {
      var objectToDiff;
      if (object instanceof this.constructor) {
        objectToDiff = object.all();
      } else {
        objectToDiff = object;
      }
      var objectKeys = Object.keys(objectToDiff);
      var remainingKeys = Object.keys(this.items).filter(function(item) {
        return objectKeys.indexOf(item) === -1;
      });
      return new this.constructor(this.items).only(remainingKeys);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/diffUsing.js
var require_diffUsing = __commonJS({
  "../../node_modules/collect.js/dist/methods/diffUsing.js"(exports, module) {
    "use strict";
    module.exports = function diffUsing(values, callback) {
      var collection = this.items.filter(function(item) {
        return !(values && values.some(function(otherItem) {
          return callback(item, otherItem) === 0;
        }));
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/doesntContain.js
var require_doesntContain = __commonJS({
  "../../node_modules/collect.js/dist/methods/doesntContain.js"(exports, module) {
    "use strict";
    module.exports = function contains(key, value) {
      return !this.contains(key, value);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/dump.js
var require_dump = __commonJS({
  "../../node_modules/collect.js/dist/methods/dump.js"(exports, module) {
    "use strict";
    module.exports = function dump() {
      console.log(this);
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/duplicates.js
var require_duplicates = __commonJS({
  "../../node_modules/collect.js/dist/methods/duplicates.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    module.exports = function duplicates() {
      var _this = this;
      var occuredValues = [];
      var duplicateValues = {};
      var stringifiedValue = function stringifiedValue2(value) {
        if (Array.isArray(value) || _typeof(value) === "object") {
          return JSON.stringify(value);
        }
        return value;
      };
      if (Array.isArray(this.items)) {
        this.items.forEach(function(value, index) {
          var valueAsString = stringifiedValue(value);
          if (occuredValues.indexOf(valueAsString) === -1) {
            occuredValues.push(valueAsString);
          } else {
            duplicateValues[index] = value;
          }
        });
      } else if (_typeof(this.items) === "object") {
        Object.keys(this.items).forEach(function(key) {
          var valueAsString = stringifiedValue(_this.items[key]);
          if (occuredValues.indexOf(valueAsString) === -1) {
            occuredValues.push(valueAsString);
          } else {
            duplicateValues[key] = _this.items[key];
          }
        });
      }
      return new this.constructor(duplicateValues);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/each.js
var require_each = __commonJS({
  "../../node_modules/collect.js/dist/methods/each.js"(exports, module) {
    "use strict";
    module.exports = function each(fn) {
      var stop = false;
      if (Array.isArray(this.items)) {
        var length = this.items.length;
        for (var index = 0; index < length && !stop; index += 1) {
          stop = fn(this.items[index], index, this.items) === false;
        }
      } else {
        var keys = Object.keys(this.items);
        var _length = keys.length;
        for (var _index = 0; _index < _length && !stop; _index += 1) {
          var key = keys[_index];
          stop = fn(this.items[key], key, this.items) === false;
        }
      }
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/eachSpread.js
var require_eachSpread = __commonJS({
  "../../node_modules/collect.js/dist/methods/eachSpread.js"(exports, module) {
    "use strict";
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    module.exports = function eachSpread(fn) {
      this.each(function(values, key) {
        fn.apply(void 0, _toConsumableArray(values).concat([key]));
      });
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/every.js
var require_every = __commonJS({
  "../../node_modules/collect.js/dist/methods/every.js"(exports, module) {
    "use strict";
    var values = require_values();
    module.exports = function every(fn) {
      var items = values(this.items);
      return items.every(fn);
    };
  }
});

// ../../node_modules/collect.js/dist/helpers/variadic.js
var require_variadic = __commonJS({
  "../../node_modules/collect.js/dist/helpers/variadic.js"(exports, module) {
    "use strict";
    module.exports = function variadic(args) {
      if (Array.isArray(args[0])) {
        return args[0];
      }
      return args;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/except.js
var require_except = __commonJS({
  "../../node_modules/collect.js/dist/methods/except.js"(exports, module) {
    "use strict";
    var variadic = require_variadic();
    module.exports = function except() {
      var _this = this;
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      var properties = variadic(args);
      if (Array.isArray(this.items)) {
        var _collection = this.items.filter(function(item) {
          return properties.indexOf(item) === -1;
        });
        return new this.constructor(_collection);
      }
      var collection = {};
      Object.keys(this.items).forEach(function(property) {
        if (properties.indexOf(property) === -1) {
          collection[property] = _this.items[property];
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/filter.js
var require_filter = __commonJS({
  "../../node_modules/collect.js/dist/methods/filter.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    function falsyValue(item) {
      if (Array.isArray(item)) {
        if (item.length) {
          return false;
        }
      } else if (item !== void 0 && item !== null && _typeof(item) === "object") {
        if (Object.keys(item).length) {
          return false;
        }
      } else if (item) {
        return false;
      }
      return true;
    }
    function filterObject(func, items) {
      var result = {};
      Object.keys(items).forEach(function(key) {
        if (func) {
          if (func(items[key], key)) {
            result[key] = items[key];
          }
        } else if (!falsyValue(items[key])) {
          result[key] = items[key];
        }
      });
      return result;
    }
    function filterArray(func, items) {
      if (func) {
        return items.filter(func);
      }
      var result = [];
      for (var i = 0; i < items.length; i += 1) {
        var item = items[i];
        if (!falsyValue(item)) {
          result.push(item);
        }
      }
      return result;
    }
    module.exports = function filter(fn) {
      var func = fn || false;
      var filteredItems = null;
      if (Array.isArray(this.items)) {
        filteredItems = filterArray(func, this.items);
      } else {
        filteredItems = filterObject(func, this.items);
      }
      return new this.constructor(filteredItems);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/first.js
var require_first = __commonJS({
  "../../node_modules/collect.js/dist/methods/first.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function first(fn, defaultValue) {
      if (isFunction(fn)) {
        var keys = Object.keys(this.items);
        for (var i = 0; i < keys.length; i += 1) {
          var key = keys[i];
          var item = this.items[key];
          if (fn(item, key)) {
            return item;
          }
        }
        if (isFunction(defaultValue)) {
          return defaultValue();
        }
        return defaultValue;
      }
      if (Array.isArray(this.items) && this.items.length || Object.keys(this.items).length) {
        if (Array.isArray(this.items)) {
          return this.items[0];
        }
        var firstKey = Object.keys(this.items)[0];
        return this.items[firstKey];
      }
      if (isFunction(defaultValue)) {
        return defaultValue();
      }
      return defaultValue;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/firstOrFail.js
var require_firstOrFail = __commonJS({
  "../../node_modules/collect.js/dist/methods/firstOrFail.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function firstOrFail(key, operator, value) {
      if (isFunction(key)) {
        return this.first(key, function() {
          throw new Error("Item not found.");
        });
      }
      var collection = this.where(key, operator, value);
      if (collection.isEmpty()) {
        throw new Error("Item not found.");
      }
      return collection.first();
    };
  }
});

// ../../node_modules/collect.js/dist/methods/firstWhere.js
var require_firstWhere = __commonJS({
  "../../node_modules/collect.js/dist/methods/firstWhere.js"(exports, module) {
    "use strict";
    module.exports = function firstWhere(key, operator, value) {
      return this.where(key, operator, value).first() || null;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/flatMap.js
var require_flatMap = __commonJS({
  "../../node_modules/collect.js/dist/methods/flatMap.js"(exports, module) {
    "use strict";
    module.exports = function flatMap(fn) {
      return this.map(fn).collapse();
    };
  }
});

// ../../node_modules/collect.js/dist/methods/flatten.js
var require_flatten = __commonJS({
  "../../node_modules/collect.js/dist/methods/flatten.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isArray = _require.isArray;
    var isObject = _require.isObject;
    module.exports = function flatten(depth) {
      var flattenDepth = depth || Infinity;
      var fullyFlattened = false;
      var collection = [];
      var flat = function flat2(items) {
        collection = [];
        if (isArray(items)) {
          items.forEach(function(item) {
            if (isArray(item)) {
              collection = collection.concat(item);
            } else if (isObject(item)) {
              Object.keys(item).forEach(function(property) {
                collection = collection.concat(item[property]);
              });
            } else {
              collection.push(item);
            }
          });
        } else {
          Object.keys(items).forEach(function(property) {
            if (isArray(items[property])) {
              collection = collection.concat(items[property]);
            } else if (isObject(items[property])) {
              Object.keys(items[property]).forEach(function(prop) {
                collection = collection.concat(items[property][prop]);
              });
            } else {
              collection.push(items[property]);
            }
          });
        }
        fullyFlattened = collection.filter(function(item) {
          return isObject(item);
        });
        fullyFlattened = fullyFlattened.length === 0;
        flattenDepth -= 1;
      };
      flat(this.items);
      while (!fullyFlattened && flattenDepth > 0) {
        flat(collection);
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/flip.js
var require_flip = __commonJS({
  "../../node_modules/collect.js/dist/methods/flip.js"(exports, module) {
    "use strict";
    module.exports = function flip() {
      var _this = this;
      var collection = {};
      if (Array.isArray(this.items)) {
        Object.keys(this.items).forEach(function(key) {
          collection[_this.items[key]] = Number(key);
        });
      } else {
        Object.keys(this.items).forEach(function(key) {
          collection[_this.items[key]] = key;
        });
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/forPage.js
var require_forPage = __commonJS({
  "../../node_modules/collect.js/dist/methods/forPage.js"(exports, module) {
    "use strict";
    module.exports = function forPage(page, chunk) {
      var _this = this;
      var collection = {};
      if (Array.isArray(this.items)) {
        collection = this.items.slice(page * chunk - chunk, page * chunk);
      } else {
        Object.keys(this.items).slice(page * chunk - chunk, page * chunk).forEach(function(key) {
          collection[key] = _this.items[key];
        });
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/forget.js
var require_forget = __commonJS({
  "../../node_modules/collect.js/dist/methods/forget.js"(exports, module) {
    "use strict";
    module.exports = function forget(key) {
      if (Array.isArray(this.items)) {
        this.items.splice(key, 1);
      } else {
        delete this.items[key];
      }
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/get.js
var require_get = __commonJS({
  "../../node_modules/collect.js/dist/methods/get.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function get(key) {
      var defaultValue = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : null;
      if (this.items[key] !== void 0) {
        return this.items[key];
      }
      if (isFunction(defaultValue)) {
        return defaultValue();
      }
      if (defaultValue !== null) {
        return defaultValue;
      }
      return null;
    };
  }
});

// ../../node_modules/collect.js/dist/helpers/nestedValue.js
var require_nestedValue = __commonJS({
  "../../node_modules/collect.js/dist/helpers/nestedValue.js"(exports, module) {
    "use strict";
    module.exports = function nestedValue(mainObject, key) {
      try {
        return key.split(".").reduce(function(obj, property) {
          return obj[property];
        }, mainObject);
      } catch (err) {
        return mainObject;
      }
    };
  }
});

// ../../node_modules/collect.js/dist/methods/groupBy.js
var require_groupBy = __commonJS({
  "../../node_modules/collect.js/dist/methods/groupBy.js"(exports, module) {
    "use strict";
    var nestedValue = require_nestedValue();
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function groupBy(key) {
      var _this = this;
      var collection = {};
      this.items.forEach(function(item, index) {
        var resolvedKey;
        if (isFunction(key)) {
          resolvedKey = key(item, index);
        } else if (nestedValue(item, key) || nestedValue(item, key) === 0) {
          resolvedKey = nestedValue(item, key);
        } else {
          resolvedKey = "";
        }
        if (collection[resolvedKey] === void 0) {
          collection[resolvedKey] = new _this.constructor([]);
        }
        collection[resolvedKey].push(item);
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/has.js
var require_has = __commonJS({
  "../../node_modules/collect.js/dist/methods/has.js"(exports, module) {
    "use strict";
    var variadic = require_variadic();
    module.exports = function has() {
      var _this = this;
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      var properties = variadic(args);
      return properties.filter(function(key) {
        return Object.hasOwnProperty.call(_this.items, key);
      }).length === properties.length;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/implode.js
var require_implode = __commonJS({
  "../../node_modules/collect.js/dist/methods/implode.js"(exports, module) {
    "use strict";
    module.exports = function implode(key, glue) {
      if (glue === void 0) {
        return this.items.join(key);
      }
      return new this.constructor(this.items).pluck(key).all().join(glue);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/intersect.js
var require_intersect = __commonJS({
  "../../node_modules/collect.js/dist/methods/intersect.js"(exports, module) {
    "use strict";
    module.exports = function intersect(values) {
      var intersectValues = values;
      if (values instanceof this.constructor) {
        intersectValues = values.all();
      }
      var collection = this.items.filter(function(item) {
        return intersectValues.indexOf(item) !== -1;
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/intersectByKeys.js
var require_intersectByKeys = __commonJS({
  "../../node_modules/collect.js/dist/methods/intersectByKeys.js"(exports, module) {
    "use strict";
    module.exports = function intersectByKeys(values) {
      var _this = this;
      var intersectKeys = Object.keys(values);
      if (values instanceof this.constructor) {
        intersectKeys = Object.keys(values.all());
      }
      var collection = {};
      Object.keys(this.items).forEach(function(key) {
        if (intersectKeys.indexOf(key) !== -1) {
          collection[key] = _this.items[key];
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/isEmpty.js
var require_isEmpty = __commonJS({
  "../../node_modules/collect.js/dist/methods/isEmpty.js"(exports, module) {
    "use strict";
    module.exports = function isEmpty() {
      if (Array.isArray(this.items)) {
        return !this.items.length;
      }
      return !Object.keys(this.items).length;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/isNotEmpty.js
var require_isNotEmpty = __commonJS({
  "../../node_modules/collect.js/dist/methods/isNotEmpty.js"(exports, module) {
    "use strict";
    module.exports = function isNotEmpty() {
      return !this.isEmpty();
    };
  }
});

// ../../node_modules/collect.js/dist/methods/join.js
var require_join = __commonJS({
  "../../node_modules/collect.js/dist/methods/join.js"(exports, module) {
    "use strict";
    module.exports = function join(glue, finalGlue) {
      var collection = this.values();
      if (finalGlue === void 0) {
        return collection.implode(glue);
      }
      var count = collection.count();
      if (count === 0) {
        return "";
      }
      if (count === 1) {
        return collection.last();
      }
      var finalItem = collection.pop();
      return collection.implode(glue) + finalGlue + finalItem;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/keyBy.js
var require_keyBy = __commonJS({
  "../../node_modules/collect.js/dist/methods/keyBy.js"(exports, module) {
    "use strict";
    var nestedValue = require_nestedValue();
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function keyBy(key) {
      var collection = {};
      if (isFunction(key)) {
        this.items.forEach(function(item) {
          collection[key(item)] = item;
        });
      } else {
        this.items.forEach(function(item) {
          var keyValue = nestedValue(item, key);
          collection[keyValue || ""] = item;
        });
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/keys.js
var require_keys = __commonJS({
  "../../node_modules/collect.js/dist/methods/keys.js"(exports, module) {
    "use strict";
    module.exports = function keys() {
      var collection = Object.keys(this.items);
      if (Array.isArray(this.items)) {
        collection = collection.map(Number);
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/last.js
var require_last = __commonJS({
  "../../node_modules/collect.js/dist/methods/last.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function last(fn, defaultValue) {
      var items = this.items;
      if (isFunction(fn)) {
        items = this.filter(fn).all();
      }
      if (Array.isArray(items) && !items.length || !Object.keys(items).length) {
        if (isFunction(defaultValue)) {
          return defaultValue();
        }
        return defaultValue;
      }
      if (Array.isArray(items)) {
        return items[items.length - 1];
      }
      var keys = Object.keys(items);
      return items[keys[keys.length - 1]];
    };
  }
});

// ../../node_modules/collect.js/dist/methods/macro.js
var require_macro = __commonJS({
  "../../node_modules/collect.js/dist/methods/macro.js"(exports, module) {
    "use strict";
    module.exports = function macro(name, fn) {
      this.constructor.prototype[name] = fn;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/make.js
var require_make = __commonJS({
  "../../node_modules/collect.js/dist/methods/make.js"(exports, module) {
    "use strict";
    module.exports = function make() {
      var items = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : [];
      return new this.constructor(items);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/map.js
var require_map = __commonJS({
  "../../node_modules/collect.js/dist/methods/map.js"(exports, module) {
    "use strict";
    module.exports = function map(fn) {
      var _this = this;
      if (Array.isArray(this.items)) {
        return new this.constructor(this.items.map(fn));
      }
      var collection = {};
      Object.keys(this.items).forEach(function(key) {
        collection[key] = fn(_this.items[key], key);
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/mapSpread.js
var require_mapSpread = __commonJS({
  "../../node_modules/collect.js/dist/methods/mapSpread.js"(exports, module) {
    "use strict";
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    module.exports = function mapSpread(fn) {
      return this.map(function(values, key) {
        return fn.apply(void 0, _toConsumableArray(values).concat([key]));
      });
    };
  }
});

// ../../node_modules/collect.js/dist/methods/mapToDictionary.js
var require_mapToDictionary = __commonJS({
  "../../node_modules/collect.js/dist/methods/mapToDictionary.js"(exports, module) {
    "use strict";
    function _slicedToArray(arr, i) {
      return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest();
    }
    function _nonIterableRest() {
      throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    function _iterableToArrayLimit(arr, i) {
      var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"];
      if (_i == null) return;
      var _arr = [];
      var _n = true;
      var _d = false;
      var _s, _e;
      try {
        for (_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true) {
          _arr.push(_s.value);
          if (i && _arr.length === i) break;
        }
      } catch (err) {
        _d = true;
        _e = err;
      } finally {
        try {
          if (!_n && _i["return"] != null) _i["return"]();
        } finally {
          if (_d) throw _e;
        }
      }
      return _arr;
    }
    function _arrayWithHoles(arr) {
      if (Array.isArray(arr)) return arr;
    }
    module.exports = function mapToDictionary(fn) {
      var collection = {};
      this.items.forEach(function(item, k) {
        var _fn = fn(item, k), _fn2 = _slicedToArray(_fn, 2), key = _fn2[0], value = _fn2[1];
        if (collection[key] === void 0) {
          collection[key] = [value];
        } else {
          collection[key].push(value);
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/mapInto.js
var require_mapInto = __commonJS({
  "../../node_modules/collect.js/dist/methods/mapInto.js"(exports, module) {
    "use strict";
    module.exports = function mapInto(ClassName) {
      return this.map(function(value, key) {
        return new ClassName(value, key);
      });
    };
  }
});

// ../../node_modules/collect.js/dist/methods/mapToGroups.js
var require_mapToGroups = __commonJS({
  "../../node_modules/collect.js/dist/methods/mapToGroups.js"(exports, module) {
    "use strict";
    function _slicedToArray(arr, i) {
      return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest();
    }
    function _nonIterableRest() {
      throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    function _iterableToArrayLimit(arr, i) {
      var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"];
      if (_i == null) return;
      var _arr = [];
      var _n = true;
      var _d = false;
      var _s, _e;
      try {
        for (_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true) {
          _arr.push(_s.value);
          if (i && _arr.length === i) break;
        }
      } catch (err) {
        _d = true;
        _e = err;
      } finally {
        try {
          if (!_n && _i["return"] != null) _i["return"]();
        } finally {
          if (_d) throw _e;
        }
      }
      return _arr;
    }
    function _arrayWithHoles(arr) {
      if (Array.isArray(arr)) return arr;
    }
    module.exports = function mapToGroups(fn) {
      var collection = {};
      this.items.forEach(function(item, key) {
        var _fn = fn(item, key), _fn2 = _slicedToArray(_fn, 2), keyed = _fn2[0], value = _fn2[1];
        if (collection[keyed] === void 0) {
          collection[keyed] = [value];
        } else {
          collection[keyed].push(value);
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/mapWithKeys.js
var require_mapWithKeys = __commonJS({
  "../../node_modules/collect.js/dist/methods/mapWithKeys.js"(exports, module) {
    "use strict";
    function _slicedToArray(arr, i) {
      return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest();
    }
    function _nonIterableRest() {
      throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    function _iterableToArrayLimit(arr, i) {
      var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"];
      if (_i == null) return;
      var _arr = [];
      var _n = true;
      var _d = false;
      var _s, _e;
      try {
        for (_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true) {
          _arr.push(_s.value);
          if (i && _arr.length === i) break;
        }
      } catch (err) {
        _d = true;
        _e = err;
      } finally {
        try {
          if (!_n && _i["return"] != null) _i["return"]();
        } finally {
          if (_d) throw _e;
        }
      }
      return _arr;
    }
    function _arrayWithHoles(arr) {
      if (Array.isArray(arr)) return arr;
    }
    module.exports = function mapWithKeys(fn) {
      var _this = this;
      var collection = {};
      if (Array.isArray(this.items)) {
        this.items.forEach(function(item, index) {
          var _fn = fn(item, index), _fn2 = _slicedToArray(_fn, 2), keyed = _fn2[0], value = _fn2[1];
          collection[keyed] = value;
        });
      } else {
        Object.keys(this.items).forEach(function(key) {
          var _fn3 = fn(_this.items[key], key), _fn4 = _slicedToArray(_fn3, 2), keyed = _fn4[0], value = _fn4[1];
          collection[keyed] = value;
        });
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/max.js
var require_max = __commonJS({
  "../../node_modules/collect.js/dist/methods/max.js"(exports, module) {
    "use strict";
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    module.exports = function max(key) {
      if (typeof key === "string") {
        var filtered = this.items.filter(function(item) {
          return item[key] !== void 0;
        });
        return Math.max.apply(Math, _toConsumableArray(filtered.map(function(item) {
          return item[key];
        })));
      }
      return Math.max.apply(Math, _toConsumableArray(this.items));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/median.js
var require_median = __commonJS({
  "../../node_modules/collect.js/dist/methods/median.js"(exports, module) {
    "use strict";
    module.exports = function median(key) {
      var length = this.items.length;
      if (key === void 0) {
        if (length % 2 === 0) {
          return (this.items[length / 2 - 1] + this.items[length / 2]) / 2;
        }
        return this.items[Math.floor(length / 2)];
      }
      if (length % 2 === 0) {
        return (this.items[length / 2 - 1][key] + this.items[length / 2][key]) / 2;
      }
      return this.items[Math.floor(length / 2)][key];
    };
  }
});

// ../../node_modules/collect.js/dist/methods/merge.js
var require_merge = __commonJS({
  "../../node_modules/collect.js/dist/methods/merge.js"(exports, module) {
    "use strict";
    module.exports = function merge(value) {
      var arrayOrObject = value;
      if (typeof arrayOrObject === "string") {
        arrayOrObject = [arrayOrObject];
      }
      if (Array.isArray(this.items) && Array.isArray(arrayOrObject)) {
        return new this.constructor(this.items.concat(arrayOrObject));
      }
      var collection = JSON.parse(JSON.stringify(this.items));
      Object.keys(arrayOrObject).forEach(function(key) {
        collection[key] = arrayOrObject[key];
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/mergeRecursive.js
var require_mergeRecursive = __commonJS({
  "../../node_modules/collect.js/dist/methods/mergeRecursive.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    function ownKeys(object, enumerableOnly) {
      var keys = Object.keys(object);
      if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        enumerableOnly && (symbols = symbols.filter(function(sym) {
          return Object.getOwnPropertyDescriptor(object, sym).enumerable;
        })), keys.push.apply(keys, symbols);
      }
      return keys;
    }
    function _objectSpread(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = null != arguments[i] ? arguments[i] : {};
        i % 2 ? ownKeys(Object(source), true).forEach(function(key) {
          _defineProperty(target, key, source[key]);
        }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function(key) {
          Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
      }
      return target;
    }
    function _defineProperty(obj, key, value) {
      if (key in obj) {
        Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
      } else {
        obj[key] = value;
      }
      return obj;
    }
    module.exports = function mergeRecursive(items) {
      var merge = function merge2(target, source) {
        var merged = {};
        var mergedKeys = Object.keys(_objectSpread(_objectSpread({}, target), source));
        mergedKeys.forEach(function(key) {
          if (target[key] === void 0 && source[key] !== void 0) {
            merged[key] = source[key];
          } else if (target[key] !== void 0 && source[key] === void 0) {
            merged[key] = target[key];
          } else if (target[key] !== void 0 && source[key] !== void 0) {
            if (target[key] === source[key]) {
              merged[key] = target[key];
            } else if (!Array.isArray(target[key]) && _typeof(target[key]) === "object" && !Array.isArray(source[key]) && _typeof(source[key]) === "object") {
              merged[key] = merge2(target[key], source[key]);
            } else {
              merged[key] = [].concat(target[key], source[key]);
            }
          }
        });
        return merged;
      };
      if (!items) {
        return this;
      }
      if (items.constructor.name === "Collection") {
        return new this.constructor(merge(this.items, items.all()));
      }
      return new this.constructor(merge(this.items, items));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/min.js
var require_min = __commonJS({
  "../../node_modules/collect.js/dist/methods/min.js"(exports, module) {
    "use strict";
    function _toConsumableArray(arr) {
      return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
    }
    function _nonIterableSpread() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    }
    function _unsupportedIterableToArray(o, minLen) {
      if (!o) return;
      if (typeof o === "string") return _arrayLikeToArray(o, minLen);
      var n = Object.prototype.toString.call(o).slice(8, -1);
      if (n === "Object" && o.constructor) n = o.constructor.name;
      if (n === "Map" || n === "Set") return Array.from(o);
      if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
    }
    function _iterableToArray(iter) {
      if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
    }
    function _arrayWithoutHoles(arr) {
      if (Array.isArray(arr)) return _arrayLikeToArray(arr);
    }
    function _arrayLikeToArray(arr, len) {
      if (len == null || len > arr.length) len = arr.length;
      for (var i = 0, arr2 = new Array(len); i < len; i++) {
        arr2[i] = arr[i];
      }
      return arr2;
    }
    module.exports = function min(key) {
      if (key !== void 0) {
        var filtered = this.items.filter(function(item) {
          return item[key] !== void 0;
        });
        return Math.min.apply(Math, _toConsumableArray(filtered.map(function(item) {
          return item[key];
        })));
      }
      return Math.min.apply(Math, _toConsumableArray(this.items));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/mode.js
var require_mode = __commonJS({
  "../../node_modules/collect.js/dist/methods/mode.js"(exports, module) {
    "use strict";
    module.exports = function mode(key) {
      var values = [];
      var highestCount = 1;
      if (!this.items.length) {
        return null;
      }
      this.items.forEach(function(item) {
        var tempValues = values.filter(function(value) {
          if (key !== void 0) {
            return value.key === item[key];
          }
          return value.key === item;
        });
        if (!tempValues.length) {
          if (key !== void 0) {
            values.push({
              key: item[key],
              count: 1
            });
          } else {
            values.push({
              key: item,
              count: 1
            });
          }
        } else {
          tempValues[0].count += 1;
          var count = tempValues[0].count;
          if (count > highestCount) {
            highestCount = count;
          }
        }
      });
      return values.filter(function(value) {
        return value.count === highestCount;
      }).map(function(value) {
        return value.key;
      });
    };
  }
});

// ../../node_modules/collect.js/dist/methods/nth.js
var require_nth = __commonJS({
  "../../node_modules/collect.js/dist/methods/nth.js"(exports, module) {
    "use strict";
    var values = require_values();
    module.exports = function nth(n) {
      var offset = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0;
      var items = values(this.items);
      var collection = items.slice(offset).filter(function(item, index) {
        return index % n === 0;
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/only.js
var require_only = __commonJS({
  "../../node_modules/collect.js/dist/methods/only.js"(exports, module) {
    "use strict";
    var variadic = require_variadic();
    module.exports = function only() {
      var _this = this;
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      var properties = variadic(args);
      if (Array.isArray(this.items)) {
        var _collection = this.items.filter(function(item) {
          return properties.indexOf(item) !== -1;
        });
        return new this.constructor(_collection);
      }
      var collection = {};
      Object.keys(this.items).forEach(function(prop) {
        if (properties.indexOf(prop) !== -1) {
          collection[prop] = _this.items[prop];
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/pad.js
var require_pad = __commonJS({
  "../../node_modules/collect.js/dist/methods/pad.js"(exports, module) {
    "use strict";
    var clone = require_clone();
    module.exports = function pad(size, value) {
      var abs = Math.abs(size);
      var count = this.count();
      if (abs <= count) {
        return this;
      }
      var diff = abs - count;
      var items = clone(this.items);
      var isArray = Array.isArray(this.items);
      var prepend = size < 0;
      for (var iterator = 0; iterator < diff; ) {
        if (!isArray) {
          if (items[iterator] !== void 0) {
            diff += 1;
          } else {
            items[iterator] = value;
          }
        } else if (prepend) {
          items.unshift(value);
        } else {
          items.push(value);
        }
        iterator += 1;
      }
      return new this.constructor(items);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/partition.js
var require_partition = __commonJS({
  "../../node_modules/collect.js/dist/methods/partition.js"(exports, module) {
    "use strict";
    module.exports = function partition(fn) {
      var _this = this;
      var arrays;
      if (Array.isArray(this.items)) {
        arrays = [new this.constructor([]), new this.constructor([])];
        this.items.forEach(function(item) {
          if (fn(item) === true) {
            arrays[0].push(item);
          } else {
            arrays[1].push(item);
          }
        });
      } else {
        arrays = [new this.constructor({}), new this.constructor({})];
        Object.keys(this.items).forEach(function(prop) {
          var value = _this.items[prop];
          if (fn(value) === true) {
            arrays[0].put(prop, value);
          } else {
            arrays[1].put(prop, value);
          }
        });
      }
      return new this.constructor(arrays);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/pipe.js
var require_pipe = __commonJS({
  "../../node_modules/collect.js/dist/methods/pipe.js"(exports, module) {
    "use strict";
    module.exports = function pipe(fn) {
      return fn(this);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/pluck.js
var require_pluck = __commonJS({
  "../../node_modules/collect.js/dist/methods/pluck.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isArray = _require.isArray;
    var isObject = _require.isObject;
    var nestedValue = require_nestedValue();
    var buildKeyPathMap = function buildKeyPathMap2(items) {
      var keyPaths = {};
      items.forEach(function(item, index) {
        function buildKeyPath(val, keyPath) {
          if (isObject(val)) {
            Object.keys(val).forEach(function(prop) {
              buildKeyPath(val[prop], "".concat(keyPath, ".").concat(prop));
            });
          } else if (isArray(val)) {
            val.forEach(function(v, i) {
              buildKeyPath(v, "".concat(keyPath, ".").concat(i));
            });
          }
          keyPaths[keyPath] = val;
        }
        buildKeyPath(item, index);
      });
      return keyPaths;
    };
    module.exports = function pluck(value, key) {
      if (value.indexOf("*") !== -1) {
        var keyPathMap = buildKeyPathMap(this.items);
        var keyMatches = [];
        if (key !== void 0) {
          var keyRegex = new RegExp("0.".concat(key), "g");
          var keyNumberOfLevels = "0.".concat(key).split(".").length;
          Object.keys(keyPathMap).forEach(function(k) {
            var matchingKey = k.match(keyRegex);
            if (matchingKey) {
              var match = matchingKey[0];
              if (match.split(".").length === keyNumberOfLevels) {
                keyMatches.push(keyPathMap[match]);
              }
            }
          });
        }
        var valueMatches = [];
        var valueRegex = new RegExp("0.".concat(value), "g");
        var valueNumberOfLevels = "0.".concat(value).split(".").length;
        Object.keys(keyPathMap).forEach(function(k) {
          var matchingValue = k.match(valueRegex);
          if (matchingValue) {
            var match = matchingValue[0];
            if (match.split(".").length === valueNumberOfLevels) {
              valueMatches.push(keyPathMap[match]);
            }
          }
        });
        if (key !== void 0) {
          var collection = {};
          this.items.forEach(function(item, index) {
            collection[keyMatches[index] || ""] = valueMatches;
          });
          return new this.constructor(collection);
        }
        return new this.constructor([valueMatches]);
      }
      if (key !== void 0) {
        var _collection = {};
        this.items.forEach(function(item) {
          if (nestedValue(item, value) !== void 0) {
            _collection[item[key] || ""] = nestedValue(item, value);
          } else {
            _collection[item[key] || ""] = null;
          }
        });
        return new this.constructor(_collection);
      }
      return this.map(function(item) {
        if (nestedValue(item, value) !== void 0) {
          return nestedValue(item, value);
        }
        return null;
      });
    };
  }
});

// ../../node_modules/collect.js/dist/helpers/deleteKeys.js
var require_deleteKeys = __commonJS({
  "../../node_modules/collect.js/dist/helpers/deleteKeys.js"(exports, module) {
    "use strict";
    var variadic = require_variadic();
    module.exports = function deleteKeys(obj) {
      for (var _len = arguments.length, keys = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        keys[_key - 1] = arguments[_key];
      }
      variadic(keys).forEach(function(key) {
        delete obj[key];
      });
    };
  }
});

// ../../node_modules/collect.js/dist/methods/pop.js
var require_pop = __commonJS({
  "../../node_modules/collect.js/dist/methods/pop.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isArray = _require.isArray;
    var isObject = _require.isObject;
    var deleteKeys = require_deleteKeys();
    module.exports = function pop() {
      var _this = this;
      var count = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 1;
      if (this.isEmpty()) {
        return null;
      }
      if (isArray(this.items)) {
        if (count === 1) {
          return this.items.pop();
        }
        return new this.constructor(this.items.splice(-count));
      }
      if (isObject(this.items)) {
        var keys = Object.keys(this.items);
        if (count === 1) {
          var key = keys[keys.length - 1];
          var last = this.items[key];
          deleteKeys(this.items, key);
          return last;
        }
        var poppedKeys = keys.slice(-count);
        var newObject = poppedKeys.reduce(function(acc, current) {
          acc[current] = _this.items[current];
          return acc;
        }, {});
        deleteKeys(this.items, poppedKeys);
        return new this.constructor(newObject);
      }
      return null;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/prepend.js
var require_prepend = __commonJS({
  "../../node_modules/collect.js/dist/methods/prepend.js"(exports, module) {
    "use strict";
    module.exports = function prepend(value, key) {
      if (key !== void 0) {
        return this.put(key, value);
      }
      this.items.unshift(value);
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/pull.js
var require_pull = __commonJS({
  "../../node_modules/collect.js/dist/methods/pull.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function pull(key, defaultValue) {
      var returnValue = this.items[key] || null;
      if (!returnValue && defaultValue !== void 0) {
        if (isFunction(defaultValue)) {
          returnValue = defaultValue();
        } else {
          returnValue = defaultValue;
        }
      }
      delete this.items[key];
      return returnValue;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/push.js
var require_push = __commonJS({
  "../../node_modules/collect.js/dist/methods/push.js"(exports, module) {
    "use strict";
    module.exports = function push() {
      var _this$items;
      (_this$items = this.items).push.apply(_this$items, arguments);
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/put.js
var require_put = __commonJS({
  "../../node_modules/collect.js/dist/methods/put.js"(exports, module) {
    "use strict";
    module.exports = function put(key, value) {
      this.items[key] = value;
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/random.js
var require_random = __commonJS({
  "../../node_modules/collect.js/dist/methods/random.js"(exports, module) {
    "use strict";
    var values = require_values();
    module.exports = function random() {
      var length = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : null;
      var items = values(this.items);
      var collection = new this.constructor(items).shuffle();
      if (length !== parseInt(length, 10)) {
        return collection.first();
      }
      return collection.take(length);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/reduce.js
var require_reduce = __commonJS({
  "../../node_modules/collect.js/dist/methods/reduce.js"(exports, module) {
    "use strict";
    module.exports = function reduce(fn, carry) {
      var _this = this;
      var reduceCarry = null;
      if (carry !== void 0) {
        reduceCarry = carry;
      }
      if (Array.isArray(this.items)) {
        this.items.forEach(function(item) {
          reduceCarry = fn(reduceCarry, item);
        });
      } else {
        Object.keys(this.items).forEach(function(key) {
          reduceCarry = fn(reduceCarry, _this.items[key], key);
        });
      }
      return reduceCarry;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/reject.js
var require_reject = __commonJS({
  "../../node_modules/collect.js/dist/methods/reject.js"(exports, module) {
    "use strict";
    module.exports = function reject(fn) {
      return new this.constructor(this.items).filter(function(item) {
        return !fn(item);
      });
    };
  }
});

// ../../node_modules/collect.js/dist/methods/replace.js
var require_replace = __commonJS({
  "../../node_modules/collect.js/dist/methods/replace.js"(exports, module) {
    "use strict";
    function ownKeys(object, enumerableOnly) {
      var keys = Object.keys(object);
      if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        enumerableOnly && (symbols = symbols.filter(function(sym) {
          return Object.getOwnPropertyDescriptor(object, sym).enumerable;
        })), keys.push.apply(keys, symbols);
      }
      return keys;
    }
    function _objectSpread(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = null != arguments[i] ? arguments[i] : {};
        i % 2 ? ownKeys(Object(source), true).forEach(function(key) {
          _defineProperty(target, key, source[key]);
        }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function(key) {
          Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
      }
      return target;
    }
    function _defineProperty(obj, key, value) {
      if (key in obj) {
        Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
      } else {
        obj[key] = value;
      }
      return obj;
    }
    module.exports = function replace(items) {
      if (!items) {
        return this;
      }
      if (Array.isArray(items)) {
        var _replaced = this.items.map(function(value, index) {
          return items[index] || value;
        });
        return new this.constructor(_replaced);
      }
      if (items.constructor.name === "Collection") {
        var _replaced2 = _objectSpread(_objectSpread({}, this.items), items.all());
        return new this.constructor(_replaced2);
      }
      var replaced = _objectSpread(_objectSpread({}, this.items), items);
      return new this.constructor(replaced);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/replaceRecursive.js
var require_replaceRecursive = __commonJS({
  "../../node_modules/collect.js/dist/methods/replaceRecursive.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    function ownKeys(object, enumerableOnly) {
      var keys = Object.keys(object);
      if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        enumerableOnly && (symbols = symbols.filter(function(sym) {
          return Object.getOwnPropertyDescriptor(object, sym).enumerable;
        })), keys.push.apply(keys, symbols);
      }
      return keys;
    }
    function _objectSpread(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = null != arguments[i] ? arguments[i] : {};
        i % 2 ? ownKeys(Object(source), true).forEach(function(key) {
          _defineProperty(target, key, source[key]);
        }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function(key) {
          Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
      }
      return target;
    }
    function _defineProperty(obj, key, value) {
      if (key in obj) {
        Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
      } else {
        obj[key] = value;
      }
      return obj;
    }
    module.exports = function replaceRecursive(items) {
      var replace = function replace2(target, source) {
        var replaced = _objectSpread({}, target);
        var mergedKeys = Object.keys(_objectSpread(_objectSpread({}, target), source));
        mergedKeys.forEach(function(key) {
          if (!Array.isArray(source[key]) && _typeof(source[key]) === "object") {
            replaced[key] = replace2(target[key], source[key]);
          } else if (target[key] === void 0 && source[key] !== void 0) {
            if (_typeof(target[key]) === "object") {
              replaced[key] = _objectSpread({}, source[key]);
            } else {
              replaced[key] = source[key];
            }
          } else if (target[key] !== void 0 && source[key] === void 0) {
            if (_typeof(target[key]) === "object") {
              replaced[key] = _objectSpread({}, target[key]);
            } else {
              replaced[key] = target[key];
            }
          } else if (target[key] !== void 0 && source[key] !== void 0) {
            if (_typeof(source[key]) === "object") {
              replaced[key] = _objectSpread({}, source[key]);
            } else {
              replaced[key] = source[key];
            }
          }
        });
        return replaced;
      };
      if (!items) {
        return this;
      }
      if (!Array.isArray(items) && _typeof(items) !== "object") {
        return new this.constructor(replace(this.items, [items]));
      }
      if (items.constructor.name === "Collection") {
        return new this.constructor(replace(this.items, items.all()));
      }
      return new this.constructor(replace(this.items, items));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/reverse.js
var require_reverse = __commonJS({
  "../../node_modules/collect.js/dist/methods/reverse.js"(exports, module) {
    "use strict";
    module.exports = function reverse() {
      var collection = [].concat(this.items).reverse();
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/search.js
var require_search = __commonJS({
  "../../node_modules/collect.js/dist/methods/search.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isArray = _require.isArray;
    var isObject = _require.isObject;
    var isFunction = _require.isFunction;
    module.exports = function search(valueOrFunction, strict) {
      var _this = this;
      var result;
      var find = function find2(item, key) {
        if (isFunction(valueOrFunction)) {
          return valueOrFunction(_this.items[key], key);
        }
        if (strict) {
          return _this.items[key] === valueOrFunction;
        }
        return _this.items[key] == valueOrFunction;
      };
      if (isArray(this.items)) {
        result = this.items.findIndex(find);
      } else if (isObject(this.items)) {
        result = Object.keys(this.items).find(function(key) {
          return find(_this.items[key], key);
        });
      }
      if (result === void 0 || result < 0) {
        return false;
      }
      return result;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/shift.js
var require_shift = __commonJS({
  "../../node_modules/collect.js/dist/methods/shift.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isArray = _require.isArray;
    var isObject = _require.isObject;
    var deleteKeys = require_deleteKeys();
    module.exports = function shift() {
      var _this = this;
      var count = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 1;
      if (this.isEmpty()) {
        return null;
      }
      if (isArray(this.items)) {
        if (count === 1) {
          return this.items.shift();
        }
        return new this.constructor(this.items.splice(0, count));
      }
      if (isObject(this.items)) {
        if (count === 1) {
          var key = Object.keys(this.items)[0];
          var value = this.items[key];
          delete this.items[key];
          return value;
        }
        var keys = Object.keys(this.items);
        var poppedKeys = keys.slice(0, count);
        var newObject = poppedKeys.reduce(function(acc, current) {
          acc[current] = _this.items[current];
          return acc;
        }, {});
        deleteKeys(this.items, poppedKeys);
        return new this.constructor(newObject);
      }
      return null;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/shuffle.js
var require_shuffle = __commonJS({
  "../../node_modules/collect.js/dist/methods/shuffle.js"(exports, module) {
    "use strict";
    var values = require_values();
    module.exports = function shuffle() {
      var items = values(this.items);
      var j;
      var x;
      var i;
      for (i = items.length; i; i -= 1) {
        j = Math.floor(Math.random() * i);
        x = items[i - 1];
        items[i - 1] = items[j];
        items[j] = x;
      }
      this.items = items;
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/skip.js
var require_skip = __commonJS({
  "../../node_modules/collect.js/dist/methods/skip.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isObject = _require.isObject;
    module.exports = function skip(number) {
      var _this = this;
      if (isObject(this.items)) {
        return new this.constructor(Object.keys(this.items).reduce(function(accumulator, key, index) {
          if (index + 1 > number) {
            accumulator[key] = _this.items[key];
          }
          return accumulator;
        }, {}));
      }
      return new this.constructor(this.items.slice(number));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/skipUntil.js
var require_skipUntil = __commonJS({
  "../../node_modules/collect.js/dist/methods/skipUntil.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isArray = _require.isArray;
    var isObject = _require.isObject;
    var isFunction = _require.isFunction;
    module.exports = function skipUntil(valueOrFunction) {
      var _this = this;
      var previous = null;
      var items;
      var callback = function callback2(value) {
        return value === valueOrFunction;
      };
      if (isFunction(valueOrFunction)) {
        callback = valueOrFunction;
      }
      if (isArray(this.items)) {
        items = this.items.filter(function(item) {
          if (previous !== true) {
            previous = callback(item);
          }
          return previous;
        });
      }
      if (isObject(this.items)) {
        items = Object.keys(this.items).reduce(function(acc, key) {
          if (previous !== true) {
            previous = callback(_this.items[key]);
          }
          if (previous !== false) {
            acc[key] = _this.items[key];
          }
          return acc;
        }, {});
      }
      return new this.constructor(items);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/skipWhile.js
var require_skipWhile = __commonJS({
  "../../node_modules/collect.js/dist/methods/skipWhile.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isArray = _require.isArray;
    var isObject = _require.isObject;
    var isFunction = _require.isFunction;
    module.exports = function skipWhile(valueOrFunction) {
      var _this = this;
      var previous = null;
      var items;
      var callback = function callback2(value) {
        return value === valueOrFunction;
      };
      if (isFunction(valueOrFunction)) {
        callback = valueOrFunction;
      }
      if (isArray(this.items)) {
        items = this.items.filter(function(item) {
          if (previous !== true) {
            previous = !callback(item);
          }
          return previous;
        });
      }
      if (isObject(this.items)) {
        items = Object.keys(this.items).reduce(function(acc, key) {
          if (previous !== true) {
            previous = !callback(_this.items[key]);
          }
          if (previous !== false) {
            acc[key] = _this.items[key];
          }
          return acc;
        }, {});
      }
      return new this.constructor(items);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/slice.js
var require_slice = __commonJS({
  "../../node_modules/collect.js/dist/methods/slice.js"(exports, module) {
    "use strict";
    module.exports = function slice(remove, limit) {
      var collection = this.items.slice(remove);
      if (limit !== void 0) {
        collection = collection.slice(0, limit);
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/sole.js
var require_sole = __commonJS({
  "../../node_modules/collect.js/dist/methods/sole.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function sole(key, operator, value) {
      var collection;
      if (isFunction(key)) {
        collection = this.filter(key);
      } else {
        collection = this.where(key, operator, value);
      }
      if (collection.isEmpty()) {
        throw new Error("Item not found.");
      }
      if (collection.count() > 1) {
        throw new Error("Multiple items found.");
      }
      return collection.first();
    };
  }
});

// ../../node_modules/collect.js/dist/methods/some.js
var require_some = __commonJS({
  "../../node_modules/collect.js/dist/methods/some.js"(exports, module) {
    "use strict";
    var contains = require_contains();
    module.exports = contains;
  }
});

// ../../node_modules/collect.js/dist/methods/sort.js
var require_sort = __commonJS({
  "../../node_modules/collect.js/dist/methods/sort.js"(exports, module) {
    "use strict";
    module.exports = function sort(fn) {
      var collection = [].concat(this.items);
      if (fn === void 0) {
        if (this.every(function(item) {
          return typeof item === "number";
        })) {
          collection.sort(function(a, b) {
            return a - b;
          });
        } else {
          collection.sort();
        }
      } else {
        collection.sort(fn);
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/sortDesc.js
var require_sortDesc = __commonJS({
  "../../node_modules/collect.js/dist/methods/sortDesc.js"(exports, module) {
    "use strict";
    module.exports = function sortDesc() {
      return this.sort().reverse();
    };
  }
});

// ../../node_modules/collect.js/dist/methods/sortBy.js
var require_sortBy = __commonJS({
  "../../node_modules/collect.js/dist/methods/sortBy.js"(exports, module) {
    "use strict";
    var nestedValue = require_nestedValue();
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function sortBy(valueOrFunction) {
      var collection = [].concat(this.items);
      var getValue = function getValue2(item) {
        if (isFunction(valueOrFunction)) {
          return valueOrFunction(item);
        }
        return nestedValue(item, valueOrFunction);
      };
      collection.sort(function(a, b) {
        var valueA = getValue(a);
        var valueB = getValue(b);
        if (valueA === null || valueA === void 0) {
          return 1;
        }
        if (valueB === null || valueB === void 0) {
          return -1;
        }
        if (valueA < valueB) {
          return -1;
        }
        if (valueA > valueB) {
          return 1;
        }
        return 0;
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/sortByDesc.js
var require_sortByDesc = __commonJS({
  "../../node_modules/collect.js/dist/methods/sortByDesc.js"(exports, module) {
    "use strict";
    module.exports = function sortByDesc(valueOrFunction) {
      return this.sortBy(valueOrFunction).reverse();
    };
  }
});

// ../../node_modules/collect.js/dist/methods/sortKeys.js
var require_sortKeys = __commonJS({
  "../../node_modules/collect.js/dist/methods/sortKeys.js"(exports, module) {
    "use strict";
    module.exports = function sortKeys() {
      var _this = this;
      var ordered = {};
      Object.keys(this.items).sort().forEach(function(key) {
        ordered[key] = _this.items[key];
      });
      return new this.constructor(ordered);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/sortKeysDesc.js
var require_sortKeysDesc = __commonJS({
  "../../node_modules/collect.js/dist/methods/sortKeysDesc.js"(exports, module) {
    "use strict";
    module.exports = function sortKeysDesc() {
      var _this = this;
      var ordered = {};
      Object.keys(this.items).sort().reverse().forEach(function(key) {
        ordered[key] = _this.items[key];
      });
      return new this.constructor(ordered);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/splice.js
var require_splice = __commonJS({
  "../../node_modules/collect.js/dist/methods/splice.js"(exports, module) {
    "use strict";
    module.exports = function splice(index, limit, replace) {
      var slicedCollection = this.slice(index, limit);
      this.items = this.diff(slicedCollection.all()).all();
      if (Array.isArray(replace)) {
        for (var iterator = 0, length = replace.length; iterator < length; iterator += 1) {
          this.items.splice(index + iterator, 0, replace[iterator]);
        }
      }
      return slicedCollection;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/split.js
var require_split = __commonJS({
  "../../node_modules/collect.js/dist/methods/split.js"(exports, module) {
    "use strict";
    module.exports = function split(numberOfGroups) {
      var itemsPerGroup = Math.round(this.items.length / numberOfGroups);
      var items = JSON.parse(JSON.stringify(this.items));
      var collection = [];
      for (var iterator = 0; iterator < numberOfGroups; iterator += 1) {
        collection.push(new this.constructor(items.splice(0, itemsPerGroup)));
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/sum.js
var require_sum = __commonJS({
  "../../node_modules/collect.js/dist/methods/sum.js"(exports, module) {
    "use strict";
    var values = require_values();
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function sum(key) {
      var items = values(this.items);
      var total = 0;
      if (key === void 0) {
        for (var i = 0, length = items.length; i < length; i += 1) {
          total += parseFloat(items[i]);
        }
      } else if (isFunction(key)) {
        for (var _i = 0, _length = items.length; _i < _length; _i += 1) {
          total += parseFloat(key(items[_i]));
        }
      } else {
        for (var _i2 = 0, _length2 = items.length; _i2 < _length2; _i2 += 1) {
          total += parseFloat(items[_i2][key]);
        }
      }
      return parseFloat(total.toPrecision(12));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/take.js
var require_take = __commonJS({
  "../../node_modules/collect.js/dist/methods/take.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    module.exports = function take(length) {
      var _this = this;
      if (!Array.isArray(this.items) && _typeof(this.items) === "object") {
        var keys = Object.keys(this.items);
        var slicedKeys;
        if (length < 0) {
          slicedKeys = keys.slice(length);
        } else {
          slicedKeys = keys.slice(0, length);
        }
        var collection = {};
        keys.forEach(function(prop) {
          if (slicedKeys.indexOf(prop) !== -1) {
            collection[prop] = _this.items[prop];
          }
        });
        return new this.constructor(collection);
      }
      if (length < 0) {
        return new this.constructor(this.items.slice(length));
      }
      return new this.constructor(this.items.slice(0, length));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/takeUntil.js
var require_takeUntil = __commonJS({
  "../../node_modules/collect.js/dist/methods/takeUntil.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isArray = _require.isArray;
    var isObject = _require.isObject;
    var isFunction = _require.isFunction;
    module.exports = function takeUntil(valueOrFunction) {
      var _this = this;
      var previous = null;
      var items;
      var callback = function callback2(value) {
        return value === valueOrFunction;
      };
      if (isFunction(valueOrFunction)) {
        callback = valueOrFunction;
      }
      if (isArray(this.items)) {
        items = this.items.filter(function(item) {
          if (previous !== false) {
            previous = !callback(item);
          }
          return previous;
        });
      }
      if (isObject(this.items)) {
        items = Object.keys(this.items).reduce(function(acc, key) {
          if (previous !== false) {
            previous = !callback(_this.items[key]);
          }
          if (previous !== false) {
            acc[key] = _this.items[key];
          }
          return acc;
        }, {});
      }
      return new this.constructor(items);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/takeWhile.js
var require_takeWhile = __commonJS({
  "../../node_modules/collect.js/dist/methods/takeWhile.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isArray = _require.isArray;
    var isObject = _require.isObject;
    var isFunction = _require.isFunction;
    module.exports = function takeWhile(valueOrFunction) {
      var _this = this;
      var previous = null;
      var items;
      var callback = function callback2(value) {
        return value === valueOrFunction;
      };
      if (isFunction(valueOrFunction)) {
        callback = valueOrFunction;
      }
      if (isArray(this.items)) {
        items = this.items.filter(function(item) {
          if (previous !== false) {
            previous = callback(item);
          }
          return previous;
        });
      }
      if (isObject(this.items)) {
        items = Object.keys(this.items).reduce(function(acc, key) {
          if (previous !== false) {
            previous = callback(_this.items[key]);
          }
          if (previous !== false) {
            acc[key] = _this.items[key];
          }
          return acc;
        }, {});
      }
      return new this.constructor(items);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/tap.js
var require_tap = __commonJS({
  "../../node_modules/collect.js/dist/methods/tap.js"(exports, module) {
    "use strict";
    module.exports = function tap(fn) {
      fn(this);
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/times.js
var require_times = __commonJS({
  "../../node_modules/collect.js/dist/methods/times.js"(exports, module) {
    "use strict";
    module.exports = function times(n, fn) {
      for (var iterator = 1; iterator <= n; iterator += 1) {
        this.items.push(fn(iterator));
      }
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/toArray.js
var require_toArray = __commonJS({
  "../../node_modules/collect.js/dist/methods/toArray.js"(exports, module) {
    "use strict";
    module.exports = function toArray() {
      var collectionInstance = this.constructor;
      function iterate(list, collection2) {
        var childCollection = [];
        if (list instanceof collectionInstance) {
          list.items.forEach(function(i) {
            return iterate(i, childCollection);
          });
          collection2.push(childCollection);
        } else if (Array.isArray(list)) {
          list.forEach(function(i) {
            return iterate(i, childCollection);
          });
          collection2.push(childCollection);
        } else {
          collection2.push(list);
        }
      }
      if (Array.isArray(this.items)) {
        var collection = [];
        this.items.forEach(function(items) {
          iterate(items, collection);
        });
        return collection;
      }
      return this.values().all();
    };
  }
});

// ../../node_modules/collect.js/dist/methods/toJson.js
var require_toJson = __commonJS({
  "../../node_modules/collect.js/dist/methods/toJson.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    module.exports = function toJson() {
      if (_typeof(this.items) === "object" && !Array.isArray(this.items)) {
        return JSON.stringify(this.all());
      }
      return JSON.stringify(this.toArray());
    };
  }
});

// ../../node_modules/collect.js/dist/methods/transform.js
var require_transform = __commonJS({
  "../../node_modules/collect.js/dist/methods/transform.js"(exports, module) {
    "use strict";
    module.exports = function transform(fn) {
      var _this = this;
      if (Array.isArray(this.items)) {
        this.items = this.items.map(fn);
      } else {
        var collection = {};
        Object.keys(this.items).forEach(function(key) {
          collection[key] = fn(_this.items[key], key);
        });
        this.items = collection;
      }
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/undot.js
var require_undot = __commonJS({
  "../../node_modules/collect.js/dist/methods/undot.js"(exports, module) {
    "use strict";
    function ownKeys(object, enumerableOnly) {
      var keys = Object.keys(object);
      if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        enumerableOnly && (symbols = symbols.filter(function(sym) {
          return Object.getOwnPropertyDescriptor(object, sym).enumerable;
        })), keys.push.apply(keys, symbols);
      }
      return keys;
    }
    function _objectSpread(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = null != arguments[i] ? arguments[i] : {};
        i % 2 ? ownKeys(Object(source), true).forEach(function(key) {
          _defineProperty(target, key, source[key]);
        }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function(key) {
          Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
      }
      return target;
    }
    function _defineProperty(obj, key, value) {
      if (key in obj) {
        Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
      } else {
        obj[key] = value;
      }
      return obj;
    }
    module.exports = function undot() {
      var _this = this;
      if (Array.isArray(this.items)) {
        return this;
      }
      var collection = {};
      Object.keys(this.items).forEach(function(key) {
        if (key.indexOf(".") !== -1) {
          var obj = collection;
          key.split(".").reduce(function(acc, current, index, array) {
            if (!acc[current]) {
              acc[current] = {};
            }
            if (index === array.length - 1) {
              acc[current] = _this.items[key];
            }
            return acc[current];
          }, obj);
          collection = _objectSpread(_objectSpread({}, collection), obj);
        } else {
          collection[key] = _this.items[key];
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/unless.js
var require_unless = __commonJS({
  "../../node_modules/collect.js/dist/methods/unless.js"(exports, module) {
    "use strict";
    module.exports = function when(value, fn, defaultFn) {
      if (!value) {
        fn(this);
      } else {
        defaultFn(this);
      }
    };
  }
});

// ../../node_modules/collect.js/dist/methods/whenNotEmpty.js
var require_whenNotEmpty = __commonJS({
  "../../node_modules/collect.js/dist/methods/whenNotEmpty.js"(exports, module) {
    "use strict";
    module.exports = function whenNotEmpty(fn, defaultFn) {
      if (Array.isArray(this.items) && this.items.length) {
        return fn(this);
      }
      if (Object.keys(this.items).length) {
        return fn(this);
      }
      if (defaultFn !== void 0) {
        if (Array.isArray(this.items) && !this.items.length) {
          return defaultFn(this);
        }
        if (!Object.keys(this.items).length) {
          return defaultFn(this);
        }
      }
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/whenEmpty.js
var require_whenEmpty = __commonJS({
  "../../node_modules/collect.js/dist/methods/whenEmpty.js"(exports, module) {
    "use strict";
    module.exports = function whenEmpty(fn, defaultFn) {
      if (Array.isArray(this.items) && !this.items.length) {
        return fn(this);
      }
      if (!Object.keys(this.items).length) {
        return fn(this);
      }
      if (defaultFn !== void 0) {
        if (Array.isArray(this.items) && this.items.length) {
          return defaultFn(this);
        }
        if (Object.keys(this.items).length) {
          return defaultFn(this);
        }
      }
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/union.js
var require_union = __commonJS({
  "../../node_modules/collect.js/dist/methods/union.js"(exports, module) {
    "use strict";
    module.exports = function union(object) {
      var _this = this;
      var collection = JSON.parse(JSON.stringify(this.items));
      Object.keys(object).forEach(function(prop) {
        if (_this.items[prop] === void 0) {
          collection[prop] = object[prop];
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/unique.js
var require_unique = __commonJS({
  "../../node_modules/collect.js/dist/methods/unique.js"(exports, module) {
    "use strict";
    var _require = require_is();
    var isFunction = _require.isFunction;
    module.exports = function unique(key) {
      var collection;
      if (key === void 0) {
        collection = this.items.filter(function(element, index, self) {
          return self.indexOf(element) === index;
        });
      } else {
        collection = [];
        var usedKeys = [];
        for (var iterator = 0, length = this.items.length; iterator < length; iterator += 1) {
          var uniqueKey = void 0;
          if (isFunction(key)) {
            uniqueKey = key(this.items[iterator]);
          } else {
            uniqueKey = this.items[iterator][key];
          }
          if (usedKeys.indexOf(uniqueKey) === -1) {
            collection.push(this.items[iterator]);
            usedKeys.push(uniqueKey);
          }
        }
      }
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/unwrap.js
var require_unwrap = __commonJS({
  "../../node_modules/collect.js/dist/methods/unwrap.js"(exports, module) {
    "use strict";
    module.exports = function unwrap(value) {
      if (value instanceof this.constructor) {
        return value.all();
      }
      return value;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/values.js
var require_values2 = __commonJS({
  "../../node_modules/collect.js/dist/methods/values.js"(exports, module) {
    "use strict";
    var getValues = require_values();
    module.exports = function values() {
      return new this.constructor(getValues(this.items));
    };
  }
});

// ../../node_modules/collect.js/dist/methods/when.js
var require_when = __commonJS({
  "../../node_modules/collect.js/dist/methods/when.js"(exports, module) {
    "use strict";
    module.exports = function when(value, fn, defaultFn) {
      if (value) {
        return fn(this, value);
      }
      if (defaultFn) {
        return defaultFn(this, value);
      }
      return this;
    };
  }
});

// ../../node_modules/collect.js/dist/methods/where.js
var require_where = __commonJS({
  "../../node_modules/collect.js/dist/methods/where.js"(exports, module) {
    "use strict";
    var values = require_values();
    var nestedValue = require_nestedValue();
    module.exports = function where(key, operator, value) {
      var comparisonOperator = operator;
      var comparisonValue = value;
      var items = values(this.items);
      if (operator === void 0 || operator === true) {
        return new this.constructor(items.filter(function(item) {
          return nestedValue(item, key);
        }));
      }
      if (operator === false) {
        return new this.constructor(items.filter(function(item) {
          return !nestedValue(item, key);
        }));
      }
      if (value === void 0) {
        comparisonValue = operator;
        comparisonOperator = "===";
      }
      var collection = items.filter(function(item) {
        switch (comparisonOperator) {
          case "==":
            return nestedValue(item, key) === Number(comparisonValue) || nestedValue(item, key) === comparisonValue.toString();
          default:
          case "===":
            return nestedValue(item, key) === comparisonValue;
          case "!=":
          case "<>":
            return nestedValue(item, key) !== Number(comparisonValue) && nestedValue(item, key) !== comparisonValue.toString();
          case "!==":
            return nestedValue(item, key) !== comparisonValue;
          case "<":
            return nestedValue(item, key) < comparisonValue;
          case "<=":
            return nestedValue(item, key) <= comparisonValue;
          case ">":
            return nestedValue(item, key) > comparisonValue;
          case ">=":
            return nestedValue(item, key) >= comparisonValue;
        }
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/whereBetween.js
var require_whereBetween = __commonJS({
  "../../node_modules/collect.js/dist/methods/whereBetween.js"(exports, module) {
    "use strict";
    module.exports = function whereBetween(key, values) {
      return this.where(key, ">=", values[0]).where(key, "<=", values[values.length - 1]);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/whereIn.js
var require_whereIn = __commonJS({
  "../../node_modules/collect.js/dist/methods/whereIn.js"(exports, module) {
    "use strict";
    var extractValues = require_values();
    var nestedValue = require_nestedValue();
    module.exports = function whereIn(key, values) {
      var items = extractValues(values);
      var collection = this.items.filter(function(item) {
        return items.indexOf(nestedValue(item, key)) !== -1;
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/whereInstanceOf.js
var require_whereInstanceOf = __commonJS({
  "../../node_modules/collect.js/dist/methods/whereInstanceOf.js"(exports, module) {
    "use strict";
    module.exports = function whereInstanceOf(type) {
      return this.filter(function(item) {
        return item instanceof type;
      });
    };
  }
});

// ../../node_modules/collect.js/dist/methods/whereNotBetween.js
var require_whereNotBetween = __commonJS({
  "../../node_modules/collect.js/dist/methods/whereNotBetween.js"(exports, module) {
    "use strict";
    var nestedValue = require_nestedValue();
    module.exports = function whereNotBetween(key, values) {
      return this.filter(function(item) {
        return nestedValue(item, key) < values[0] || nestedValue(item, key) > values[values.length - 1];
      });
    };
  }
});

// ../../node_modules/collect.js/dist/methods/whereNotIn.js
var require_whereNotIn = __commonJS({
  "../../node_modules/collect.js/dist/methods/whereNotIn.js"(exports, module) {
    "use strict";
    var extractValues = require_values();
    var nestedValue = require_nestedValue();
    module.exports = function whereNotIn(key, values) {
      var items = extractValues(values);
      var collection = this.items.filter(function(item) {
        return items.indexOf(nestedValue(item, key)) === -1;
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/whereNull.js
var require_whereNull = __commonJS({
  "../../node_modules/collect.js/dist/methods/whereNull.js"(exports, module) {
    "use strict";
    module.exports = function whereNull() {
      var key = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : null;
      return this.where(key, "===", null);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/whereNotNull.js
var require_whereNotNull = __commonJS({
  "../../node_modules/collect.js/dist/methods/whereNotNull.js"(exports, module) {
    "use strict";
    module.exports = function whereNotNull() {
      var key = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : null;
      return this.where(key, "!==", null);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/wrap.js
var require_wrap = __commonJS({
  "../../node_modules/collect.js/dist/methods/wrap.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    module.exports = function wrap(value) {
      if (value instanceof this.constructor) {
        return value;
      }
      if (_typeof(value) === "object") {
        return new this.constructor(value);
      }
      return new this.constructor([value]);
    };
  }
});

// ../../node_modules/collect.js/dist/methods/zip.js
var require_zip = __commonJS({
  "../../node_modules/collect.js/dist/methods/zip.js"(exports, module) {
    "use strict";
    module.exports = function zip(array) {
      var _this = this;
      var values = array;
      if (values instanceof this.constructor) {
        values = values.all();
      }
      var collection = this.items.map(function(item, index) {
        return new _this.constructor([item, values[index]]);
      });
      return new this.constructor(collection);
    };
  }
});

// ../../node_modules/collect.js/dist/index.js
var require_dist = __commonJS({
  "../../node_modules/collect.js/dist/index.js"(exports, module) {
    "use strict";
    function _typeof(obj) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
        return typeof obj2;
      } : function(obj2) {
        return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      }, _typeof(obj);
    }
    function Collection(collection) {
      if (collection !== void 0 && !Array.isArray(collection) && _typeof(collection) !== "object") {
        this.items = [collection];
      } else if (collection instanceof this.constructor) {
        this.items = collection.all();
      } else {
        this.items = collection || [];
      }
    }
    var SymbolIterator = require_symbol_iterator();
    if (typeof Symbol !== "undefined") {
      Collection.prototype[Symbol.iterator] = SymbolIterator;
    }
    Collection.prototype.toJSON = function toJSON() {
      return this.items;
    };
    Collection.prototype.all = require_all();
    Collection.prototype.average = require_average();
    Collection.prototype.avg = require_avg();
    Collection.prototype.chunk = require_chunk();
    Collection.prototype.collapse = require_collapse();
    Collection.prototype.combine = require_combine();
    Collection.prototype.concat = require_concat();
    Collection.prototype.contains = require_contains();
    Collection.prototype.containsOneItem = require_containsOneItem();
    Collection.prototype.count = require_count();
    Collection.prototype.countBy = require_countBy();
    Collection.prototype.crossJoin = require_crossJoin();
    Collection.prototype.dd = require_dd();
    Collection.prototype.diff = require_diff();
    Collection.prototype.diffAssoc = require_diffAssoc();
    Collection.prototype.diffKeys = require_diffKeys();
    Collection.prototype.diffUsing = require_diffUsing();
    Collection.prototype.doesntContain = require_doesntContain();
    Collection.prototype.dump = require_dump();
    Collection.prototype.duplicates = require_duplicates();
    Collection.prototype.each = require_each();
    Collection.prototype.eachSpread = require_eachSpread();
    Collection.prototype.every = require_every();
    Collection.prototype.except = require_except();
    Collection.prototype.filter = require_filter();
    Collection.prototype.first = require_first();
    Collection.prototype.firstOrFail = require_firstOrFail();
    Collection.prototype.firstWhere = require_firstWhere();
    Collection.prototype.flatMap = require_flatMap();
    Collection.prototype.flatten = require_flatten();
    Collection.prototype.flip = require_flip();
    Collection.prototype.forPage = require_forPage();
    Collection.prototype.forget = require_forget();
    Collection.prototype.get = require_get();
    Collection.prototype.groupBy = require_groupBy();
    Collection.prototype.has = require_has();
    Collection.prototype.implode = require_implode();
    Collection.prototype.intersect = require_intersect();
    Collection.prototype.intersectByKeys = require_intersectByKeys();
    Collection.prototype.isEmpty = require_isEmpty();
    Collection.prototype.isNotEmpty = require_isNotEmpty();
    Collection.prototype.join = require_join();
    Collection.prototype.keyBy = require_keyBy();
    Collection.prototype.keys = require_keys();
    Collection.prototype.last = require_last();
    Collection.prototype.macro = require_macro();
    Collection.prototype.make = require_make();
    Collection.prototype.map = require_map();
    Collection.prototype.mapSpread = require_mapSpread();
    Collection.prototype.mapToDictionary = require_mapToDictionary();
    Collection.prototype.mapInto = require_mapInto();
    Collection.prototype.mapToGroups = require_mapToGroups();
    Collection.prototype.mapWithKeys = require_mapWithKeys();
    Collection.prototype.max = require_max();
    Collection.prototype.median = require_median();
    Collection.prototype.merge = require_merge();
    Collection.prototype.mergeRecursive = require_mergeRecursive();
    Collection.prototype.min = require_min();
    Collection.prototype.mode = require_mode();
    Collection.prototype.nth = require_nth();
    Collection.prototype.only = require_only();
    Collection.prototype.pad = require_pad();
    Collection.prototype.partition = require_partition();
    Collection.prototype.pipe = require_pipe();
    Collection.prototype.pluck = require_pluck();
    Collection.prototype.pop = require_pop();
    Collection.prototype.prepend = require_prepend();
    Collection.prototype.pull = require_pull();
    Collection.prototype.push = require_push();
    Collection.prototype.put = require_put();
    Collection.prototype.random = require_random();
    Collection.prototype.reduce = require_reduce();
    Collection.prototype.reject = require_reject();
    Collection.prototype.replace = require_replace();
    Collection.prototype.replaceRecursive = require_replaceRecursive();
    Collection.prototype.reverse = require_reverse();
    Collection.prototype.search = require_search();
    Collection.prototype.shift = require_shift();
    Collection.prototype.shuffle = require_shuffle();
    Collection.prototype.skip = require_skip();
    Collection.prototype.skipUntil = require_skipUntil();
    Collection.prototype.skipWhile = require_skipWhile();
    Collection.prototype.slice = require_slice();
    Collection.prototype.sole = require_sole();
    Collection.prototype.some = require_some();
    Collection.prototype.sort = require_sort();
    Collection.prototype.sortDesc = require_sortDesc();
    Collection.prototype.sortBy = require_sortBy();
    Collection.prototype.sortByDesc = require_sortByDesc();
    Collection.prototype.sortKeys = require_sortKeys();
    Collection.prototype.sortKeysDesc = require_sortKeysDesc();
    Collection.prototype.splice = require_splice();
    Collection.prototype.split = require_split();
    Collection.prototype.sum = require_sum();
    Collection.prototype.take = require_take();
    Collection.prototype.takeUntil = require_takeUntil();
    Collection.prototype.takeWhile = require_takeWhile();
    Collection.prototype.tap = require_tap();
    Collection.prototype.times = require_times();
    Collection.prototype.toArray = require_toArray();
    Collection.prototype.toJson = require_toJson();
    Collection.prototype.transform = require_transform();
    Collection.prototype.undot = require_undot();
    Collection.prototype.unless = require_unless();
    Collection.prototype.unlessEmpty = require_whenNotEmpty();
    Collection.prototype.unlessNotEmpty = require_whenEmpty();
    Collection.prototype.union = require_union();
    Collection.prototype.unique = require_unique();
    Collection.prototype.unwrap = require_unwrap();
    Collection.prototype.values = require_values2();
    Collection.prototype.when = require_when();
    Collection.prototype.whenEmpty = require_whenEmpty();
    Collection.prototype.whenNotEmpty = require_whenNotEmpty();
    Collection.prototype.where = require_where();
    Collection.prototype.whereBetween = require_whereBetween();
    Collection.prototype.whereIn = require_whereIn();
    Collection.prototype.whereInstanceOf = require_whereInstanceOf();
    Collection.prototype.whereNotBetween = require_whereNotBetween();
    Collection.prototype.whereNotIn = require_whereNotIn();
    Collection.prototype.whereNull = require_whereNull();
    Collection.prototype.whereNotNull = require_whereNotNull();
    Collection.prototype.wrap = require_wrap();
    Collection.prototype.zip = require_zip();
    var collect4 = function collect5(collection) {
      return new Collection(collection);
    };
    module.exports = collect4;
    module.exports.collect = collect4;
    module.exports["default"] = collect4;
    module.exports.Collection = Collection;
  }
});

// src/index.ts
import * as core from "@actions/core";
import * as github from "@actions/github";

// ../review/dist/index.js
var import_collect = __toESM(require_dist(), 1);
var import_collect2 = __toESM(require_dist(), 1);
import * as fs from "fs";
import { execFileSync } from "child_process";
import {
  indexCodebase,
  ComplexityAnalyzer,
  RISK_ORDER
} from "@liendev/core";
import { Octokit } from "@octokit/rest";

// ../../node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error2) => {
      for (const issue of error2.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error2 = new ZodError(issues);
  return error2;
};

// ../../node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error2 = new ZodError(ctx.common.issues);
        this._error = error2;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error2) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error2
        }
      });
    }
    function makeReturnsIssue(returns, error2) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error2
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error2 = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error2.addIssue(makeArgsIssue(args, e));
          throw error2;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error2.addIssue(makeReturnsIssue(result, e));
          throw error2;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// ../review/dist/index.js
var import_collect3 = __toESM(require_dist(), 1);
function createOctokit(token) {
  return new Octokit({ auth: token });
}
async function getPRChangedFiles(octokit, prContext) {
  const files = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const response = await octokit.pulls.listFiles({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      per_page: perPage,
      page
    });
    for (const file of response.data) {
      if (file.status !== "removed") {
        files.push(file.filename);
      }
    }
    if (response.data.length < perPage) {
      break;
    }
    page++;
  }
  return files;
}
async function postPRComment(octokit, prContext, body, logger) {
  const existingComment = await findExistingComment(octokit, prContext);
  if (existingComment) {
    logger.info(`Updating existing comment ${existingComment.id}`);
    await octokit.issues.updateComment({
      owner: prContext.owner,
      repo: prContext.repo,
      comment_id: existingComment.id,
      body
    });
  } else {
    logger.info("Creating new comment");
    await octokit.issues.createComment({
      owner: prContext.owner,
      repo: prContext.repo,
      issue_number: prContext.pullNumber,
      body
    });
  }
}
async function findExistingComment(octokit, prContext) {
  const COMMENT_MARKER = "<!-- lien-ai-review -->";
  const comments = await octokit.issues.listComments({
    owner: prContext.owner,
    repo: prContext.repo,
    issue_number: prContext.pullNumber
  });
  for (const comment of comments.data) {
    if (comment.body?.includes(COMMENT_MARKER)) {
      return { id: comment.id };
    }
  }
  return null;
}
async function getFileContent(octokit, prContext, filepath, startLine, endLine, logger) {
  try {
    const response = await octokit.repos.getContent({
      owner: prContext.owner,
      repo: prContext.repo,
      path: filepath,
      ref: prContext.headSha
    });
    if ("content" in response.data) {
      const content = Buffer.from(response.data.content, "base64").toString("utf-8");
      const lines = content.split("\n");
      const snippet = lines.slice(startLine - 1, endLine).join("\n");
      return snippet;
    }
  } catch (error2) {
    logger.warning(`Failed to get content for ${filepath}: ${error2}`);
  }
  return null;
}
async function postPRReview(octokit, prContext, comments, summaryBody, logger, event = "COMMENT") {
  if (comments.length === 0) {
    await postPRComment(octokit, prContext, summaryBody, logger);
    return;
  }
  logger.info(`Creating review with ${comments.length} line comments (event: ${event})`);
  try {
    await octokit.pulls.createReview({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      commit_id: prContext.headSha,
      event,
      body: summaryBody,
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body
      }))
    });
    logger.info("Review posted successfully");
  } catch (error2) {
    logger.warning(`Failed to post line comments: ${error2}`);
    logger.info("Falling back to regular PR comment");
    await postPRComment(octokit, prContext, summaryBody, logger);
  }
}
var DESCRIPTION_START_MARKER = "<!-- lien-stats -->";
var DESCRIPTION_END_MARKER = "<!-- /lien-stats -->";
async function updatePRDescription(octokit, prContext, badgeMarkdown, logger) {
  try {
    const { data: pr } = await octokit.pulls.get({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber
    });
    const currentBody = pr.body || "";
    const wrappedBadge = `${DESCRIPTION_START_MARKER}
${badgeMarkdown}
${DESCRIPTION_END_MARKER}`;
    let newBody;
    const startIdx = currentBody.indexOf(DESCRIPTION_START_MARKER);
    const endIdx = currentBody.indexOf(DESCRIPTION_END_MARKER);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      newBody = currentBody.slice(0, startIdx) + wrappedBadge + currentBody.slice(endIdx + DESCRIPTION_END_MARKER.length);
      logger.info("Updating existing stats badge in PR description");
    } else {
      newBody = currentBody.trim() + "\n\n---\n\n" + wrappedBadge;
      logger.info("Adding stats badge to PR description");
    }
    await octokit.pulls.update({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      body: newBody
    });
    logger.info("PR description updated with complexity stats");
  } catch (error2) {
    logger.warning(`Failed to update PR description: ${error2}`);
  }
}
function parsePatchLines(patch) {
  const lines = /* @__PURE__ */ new Set();
  let currentLine = 0;
  for (const patchLine of patch.split("\n")) {
    const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }
    if (patchLine.startsWith("+") || patchLine.startsWith(" ")) {
      if (!patchLine.startsWith("+++")) {
        lines.add(currentLine);
        currentLine++;
      }
    }
  }
  return lines;
}
async function getPRPatchData(octokit, prContext) {
  const diffLines = /* @__PURE__ */ new Map();
  const patches = /* @__PURE__ */ new Map();
  const iterator = octokit.paginate.iterator(octokit.pulls.listFiles, {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    per_page: 100
  });
  for await (const response of iterator) {
    for (const file of response.data) {
      if (!file.patch) continue;
      patches.set(file.filename, file.patch);
      const lines = parsePatchLines(file.patch);
      if (lines.size > 0) {
        diffLines.set(file.filename, lines);
      }
    }
  }
  return { diffLines, patches };
}
function formatTime(minutes) {
  const sign = minutes < 0 ? "-" : "";
  const roundedMinutes = Math.round(Math.abs(minutes));
  if (roundedMinutes >= 60) {
    const hours = Math.floor(roundedMinutes / 60);
    const mins = roundedMinutes % 60;
    return mins > 0 ? `${sign}${hours}h ${mins}m` : `${sign}${hours}h`;
  }
  return `${sign}${roundedMinutes}m`;
}
function formatDeltaValue(metricType, delta) {
  if (metricType === "halstead_bugs") {
    return delta.toFixed(2);
  }
  if (metricType === "halstead_effort") {
    return formatTime(delta);
  }
  return String(Math.round(delta));
}
var COMMENT_EXAMPLES = {
  cyclomatic: `The 5 permission cases (lines 45-67) can be extracted to \`checkAdminAccess()\`, \`checkEditorAccess()\`, \`checkViewerAccess()\`. Each returns early if unauthorized, reducing test paths from ~15 to ~5.`,
  cognitive: `The 6 levels of nesting create significant mental load. Flatten with guard clauses: \`if (!user) return null;\` at line 23, then \`if (!hasPermission) throw new UnauthorizedError();\` at line 28. The remaining logic becomes linear.`,
  halstead_effort: `This function uses 23 unique operators across complex expressions. Extract the date math (lines 34-41) into \`calculateDaysUntilExpiry()\` and replace magic numbers (30, 86400) with named constants.`,
  halstead_bugs: `High predicted bug density from complex expressions. The chained ternaries on lines 56-62 should be a lookup object: \`const STATUS_MAP = { pending: 'yellow', approved: 'green', ... }\`. Reduces operator count and improves readability.`
};
var DEFAULT_EXAMPLE = COMMENT_EXAMPLES.cyclomatic;
function getMetricLabel(metricType) {
  switch (metricType) {
    case "cognitive":
      return "mental load";
    case "cyclomatic":
      return "test paths";
    case "halstead_effort":
      return "time to understand";
    case "halstead_bugs":
      return "estimated bugs";
    default:
      return "complexity";
  }
}
function formatComplexityValue(metricType, value) {
  switch (metricType) {
    case "halstead_effort":
      return `~${formatTime(value)}`;
    case "halstead_bugs":
      return value.toFixed(2);
    case "cyclomatic":
      return `${value} tests`;
    default:
      return value.toString();
  }
}
function formatThresholdValue(metricType, value) {
  switch (metricType) {
    case "halstead_effort":
      return formatTime(value);
    case "halstead_bugs":
      return value.toFixed(1);
    default:
      return value.toString();
  }
}
function buildDependencyContext(fileData) {
  if (!fileData.dependentCount || fileData.dependentCount === 0) {
    return "";
  }
  const riskEmoji = {
    low: "\u{1F7E2}",
    medium: "\u{1F7E1}",
    high: "\u{1F7E0}",
    critical: "\u{1F534}"
  };
  const emoji = riskEmoji[fileData.riskLevel] || "\u26AA";
  const hasDependentsList = fileData.dependents && fileData.dependents.length > 0;
  const dependentsList = hasDependentsList ? fileData.dependents.slice(0, 10).map((f) => `  - ${f}`).join("\n") : "";
  const complexityNote = fileData.dependentComplexityMetrics ? `
- **Dependent complexity**: Avg ${fileData.dependentComplexityMetrics.averageComplexity.toFixed(1)}, Max ${fileData.dependentComplexityMetrics.maxComplexity}` : "";
  const moreNote = hasDependentsList && fileData.dependents.length > 10 ? "\n  ... (and more)" : "";
  return `
**Dependency Impact**: ${emoji} ${fileData.riskLevel.toUpperCase()} risk
- **Dependents**: ${fileData.dependentCount} file(s) import this
${dependentsList ? `
**Key dependents:**
${dependentsList}${moreNote}` : ""}${complexityNote}
- **Review focus**: Changes here affect ${fileData.dependentCount} other file(s). Extra scrutiny recommended.`;
}
var LANGUAGE_NAMES = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  php: "PHP",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  ruby: "Ruby",
  swift: "Swift",
  kotlin: "Kotlin",
  csharp: "C#",
  scala: "Scala",
  cpp: "C++",
  c: "C"
};
var EXTENSION_LANGUAGES = {
  ts: "TypeScript",
  tsx: "TypeScript React",
  js: "JavaScript",
  jsx: "JavaScript React",
  mjs: "JavaScript",
  cjs: "JavaScript",
  php: "PHP",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  rb: "Ruby",
  swift: "Swift",
  kt: "Kotlin",
  cs: "C#",
  scala: "Scala",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  c: "C"
};
var FILE_TYPE_PATTERNS = [
  { pattern: "controller", type: "Controller" },
  { pattern: "service", type: "Service" },
  { pattern: "component", type: "Component" },
  { pattern: "middleware", type: "Middleware" },
  { pattern: "handler", type: "Handler" },
  { pattern: "util", type: "Utility" },
  { pattern: "helper", type: "Utility" },
  { pattern: "_test.", type: "Test" },
  { pattern: "/model/", type: "Model" },
  { pattern: "/models/", type: "Model" },
  { pattern: "/repository/", type: "Repository" },
  { pattern: "/repositories/", type: "Repository" }
];
function detectLanguage(filepath, violations) {
  const languageFromViolation = violations[0]?.language;
  if (languageFromViolation) {
    return LANGUAGE_NAMES[languageFromViolation.toLowerCase()] || languageFromViolation;
  }
  const ext = filepath.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_LANGUAGES[ext] || null : null;
}
function detectFileType(filepath) {
  const pathLower = filepath.toLowerCase();
  const match = FILE_TYPE_PATTERNS.find((p) => pathLower.includes(p.pattern));
  return match?.type || null;
}
function buildFileContext(filepath, fileData) {
  const parts = [];
  const language = detectLanguage(filepath, fileData.violations);
  if (language) parts.push(`Language: ${language}`);
  const fileType = detectFileType(filepath);
  if (fileType) parts.push(`Type: ${fileType}`);
  if (fileData.violations.length > 1) {
    parts.push(`${fileData.violations.length} total violations in this file`);
  }
  return parts.length > 0 ? `
*Context: ${parts.join(", ")}*` : "";
}
function buildNoViolationsMessage(prContext, deltas = null) {
  let deltaMessage = "";
  if (deltas && deltas.length > 0) {
    const improved = deltas.filter((d) => d.severity === "improved" || d.severity === "deleted");
    if (improved.length > 0) {
      deltaMessage = `

\u{1F389} **Great job!** This PR improved complexity in ${improved.length} function(s).`;
    }
  }
  return `<!-- lien-ai-review -->
## \u2705 Lien Complexity Analysis

No complexity violations found in PR #${prContext.pullNumber}.

All analyzed functions are within the configured complexity threshold.${deltaMessage}`;
}
function countViolationsByNovelty(totalViolations, deltas) {
  if (!deltas || deltas.length === 0) {
    return { newCount: 0, preExistingCount: 0, improvedCount: 0 };
  }
  const newCount = deltas.filter((d) => d.severity === "new" || d.severity === "warning" || d.severity === "error").filter((d) => d.severity === "new" || d.delta > 0).length;
  const improvedCount = deltas.filter((d) => d.severity === "improved").length;
  const preExistingCount = Math.max(0, totalViolations - newCount);
  return { newCount, preExistingCount, improvedCount };
}
function buildHeaderLine(totalViolations, deltas) {
  const { newCount, preExistingCount, improvedCount } = countViolationsByNovelty(
    totalViolations,
    deltas
  );
  if (!deltas || deltas.length === 0) {
    return `${totalViolations} issue${totalViolations === 1 ? "" : "s"} spotted in this PR.`;
  }
  const parts = [];
  if (newCount > 0) {
    parts.push(`${newCount} new issue${newCount === 1 ? "" : "s"} spotted in this PR.`);
  } else {
    parts.push("No new complexity introduced.");
  }
  if (improvedCount > 0) {
    parts.push(`${improvedCount} function${improvedCount === 1 ? "" : "s"} improved.`);
  }
  if (preExistingCount > 0) {
    parts.push(
      `${preExistingCount} pre-existing issue${preExistingCount === 1 ? "" : "s"} in touched files.`
    );
  }
  return parts.join(" ");
}
function getViolationKey(violation) {
  return `${violation.filepath}::${violation.symbolName}`;
}
function determineStatus(report, deltaSummary) {
  const violations = report?.summary.totalViolations ?? 0;
  const errors = report?.summary.bySeverity.error ?? 0;
  const delta = deltaSummary?.totalDelta ?? 0;
  const newViolations = deltaSummary?.newFunctions ?? 0;
  const preExisting = Math.max(0, violations - newViolations);
  if (delta < 0) {
    if (preExisting > 0) {
      return {
        emoji: "\u2705",
        message: `**Improved!** Complexity reduced by ${Math.abs(delta)}. ${preExisting} pre-existing issue${preExisting === 1 ? "" : "s"} remain${preExisting === 1 ? "s" : ""} in touched files.`
      };
    }
    return {
      emoji: "\u2705",
      message: `**Improved!** This PR reduces complexity by ${Math.abs(delta)}.`
    };
  }
  if (newViolations > 0 && errors > 0) {
    return {
      emoji: "\u{1F534}",
      message: `**Review required** - ${newViolations} new function${newViolations === 1 ? " is" : "s are"} too complex.`
    };
  }
  if (newViolations > 0) {
    return {
      emoji: "\u26A0\uFE0F",
      message: `**Needs attention** - ${newViolations} new function${newViolations === 1 ? " is" : "s are"} more complex than recommended.`
    };
  }
  if (violations > 0) {
    return {
      emoji: "\u27A1\uFE0F",
      message: `**Stable** - ${preExisting} pre-existing issue${preExisting === 1 ? "" : "s"} in touched files (none introduced).`
    };
  }
  if (delta > 0) {
    return {
      emoji: "\u27A1\uFE0F",
      message: "**Stable** - Complexity increased slightly but within limits."
    };
  }
  return { emoji: "\u2705", message: "**Good** - No complexity issues found." };
}
function getMetricEmoji(metricType) {
  switch (metricType) {
    case "cyclomatic":
      return "\u{1F500}";
    case "cognitive":
      return "\u{1F9E0}";
    case "halstead_effort":
      return "\u23F1\uFE0F";
    case "halstead_bugs":
      return "\u{1F41B}";
    default:
      return "\u{1F4CA}";
  }
}
function buildMetricTable(report, deltas) {
  if (!report || report.summary.totalViolations === 0) return "";
  const byMetric = (0, import_collect2.default)(Object.values(report.files)).flatMap((f) => f.violations).countBy("metricType").all();
  const deltaByMetric = deltas ? (0, import_collect2.default)(deltas).groupBy("metricType").map((group) => group.sum("delta")).all() : {};
  const metricOrder = ["cyclomatic", "cognitive", "halstead_effort", "halstead_bugs"];
  const rows = (0, import_collect2.default)(metricOrder).filter((metricType) => byMetric[metricType] > 0).map((metricType) => {
    const emoji = getMetricEmoji(metricType);
    const label = getMetricLabel(metricType);
    const count = byMetric[metricType];
    const delta = deltaByMetric[metricType] || 0;
    const deltaStr = deltas ? delta >= 0 ? `+${delta}` : `${delta}` : "\u2014";
    return `| ${emoji} ${label} | ${count} | ${deltaStr} |`;
  }).all();
  if (rows.length === 0) return "";
  return `
| Metric | Violations | Change |
|--------|:----------:|:------:|
${rows.join("\n")}
`;
}
function buildImpactSummary(report) {
  if (!report) return "";
  const filesWithDependents = Object.values(report.files).filter(
    (f) => f.dependentCount && f.dependentCount > 0
  );
  if (filesWithDependents.length === 0) return "";
  const totalDependents = filesWithDependents.reduce((sum, f) => sum + (f.dependentCount || 0), 0);
  const highRiskFiles = filesWithDependents.filter(
    (f) => ["high", "critical"].includes(f.riskLevel)
  ).length;
  if (highRiskFiles === 0) return "";
  return `
\u{1F517} **Impact**: ${highRiskFiles} high-risk file(s) with ${totalDependents} total dependents`;
}
function buildDescriptionBadge(report, deltaSummary, deltas) {
  const status = determineStatus(report, deltaSummary);
  const metricTable = buildMetricTable(report, deltas);
  const impactSummary = buildImpactSummary(report);
  return `### \u{1F441}\uFE0F Veille

${status.emoji} ${status.message}${impactSummary}
${metricTable}
*[Veille](https://lien.dev) by Lien*`;
}
function formatHalsteadContext(violation) {
  if (!violation.metricType?.startsWith("halstead_")) return "";
  if (!violation.halsteadDetails) return "";
  const details = violation.halsteadDetails;
  return `
**Halstead Metrics**: Volume: ${details.volume?.toLocaleString()}, Difficulty: ${details.difficulty?.toFixed(1)}, Effort: ${details.effort?.toLocaleString()}, Est. bugs: ${details.bugs?.toFixed(3)}`;
}
function getExampleForPrimaryMetric(violations) {
  if (violations.length === 0) return DEFAULT_EXAMPLE;
  const counts = (0, import_collect2.default)(violations).countBy((v) => v.metricType || "cyclomatic").all();
  const maxType = Object.entries(counts).reduce(
    (max, [type, count]) => count > max.count ? { type, count } : max,
    { type: "cyclomatic", count: 0 }
  ).type;
  return COMMENT_EXAMPLES[maxType] || DEFAULT_EXAMPLE;
}
function formatMetricLine(v) {
  const metricType = v.metricType || "cyclomatic";
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, v.complexity);
  const thresholdDisplay = formatThresholdValue(metricType, v.threshold);
  const halsteadContext = formatHalsteadContext(v);
  return `- **${metricLabel}**: ${valueDisplay} (threshold: ${thresholdDisplay}) [${v.severity}]${halsteadContext}`;
}
function buildViolationSection(index, key, groupViolations, codeSnippets, report, diffHunks) {
  const first = groupViolations[0];
  const snippet = codeSnippets.get(key);
  const snippetSection = snippet ? `
Code:
\`\`\`
${snippet}
\`\`\`` : "";
  const metricLines = groupViolations.map(formatMetricLine).join("\n");
  const fileData = report.files[first.filepath];
  const dependencyContext = fileData ? buildDependencyContext(fileData) : "";
  const fileContext = fileData ? buildFileContext(first.filepath, fileData) : "";
  const testContext = fileData && fileData.testAssociations && fileData.testAssociations.length > 0 ? `
- **Test files**: ${fileData.testAssociations.join(", ")}` : fileData ? "\n- **Tests**: None found \u2014 consider adding tests" : "";
  const hunk = diffHunks?.get(key);
  const diffSection = hunk ? `
**Changes in this PR (diff):**
\`\`\`diff
${hunk}
\`\`\`` : "";
  return `### ${index}. ${key}
- **Function**: \`${first.symbolName}\` (${first.symbolType})
${metricLines}${fileContext}${testContext}${dependencyContext}${snippetSection}${diffSection}`;
}
function buildBatchedCommentsPrompt(violations, codeSnippets, report, diffHunks) {
  const grouped = /* @__PURE__ */ new Map();
  for (const v of violations) {
    const key = `${v.filepath}::${v.symbolName}`;
    const existing = grouped.get(key) || [];
    existing.push(v);
    grouped.set(key, existing);
  }
  let sectionIndex = 0;
  const violationsText = Array.from(grouped.entries()).map(([key, groupViolations]) => {
    sectionIndex++;
    return buildViolationSection(
      sectionIndex,
      key,
      groupViolations,
      codeSnippets,
      report,
      diffHunks
    );
  }).join("\n\n");
  const jsonKeys = Array.from(grouped.keys()).map((key) => `  "${key}": "your comment here"`).join(",\n");
  return `You are a senior engineer reviewing code for complexity. Generate thoughtful, context-aware review comments.

## Violations to Review

${violationsText}

## Instructions

**IMPORTANT**: Before suggesting refactorings, analyze the code snippets provided to identify the codebase's patterns:
- Are utilities implemented as functions or classes?
- How are similar refactorings done elsewhere in the codebase?
- What naming conventions are used?

For each violation, write a code review comment that:

1. **Identifies the specific pattern** causing complexity (not just "too complex")
   - Is it nested conditionals? Long parameter lists? Multiple responsibilities?
   - For Halstead metrics: many unique operators/operands, complex expressions
   - Be specific: "5 levels of nesting" not "deeply nested"

2. **Suggests a concrete fix** with a short code example (3-5 lines)
   - Consider: early returns, guard clauses, lookup tables, extracting helpers, strategy pattern
   - For Halstead: named constants, reducing operator variety, extracting complex expressions
   - Name specific functions: "Extract \`handleAdminCase()\`" not "extract a function"
   - Choose the SIMPLEST fix that addresses the issue (KISS principle)
   - **Match the existing codebase patterns** - if utilities are functions, suggest functions; if they're classes, suggest classes

3. **Acknowledges context** when relevant
   - If this is an orchestration function, complexity may be acceptable
   - If the logic is inherently complex (state machines, parsers), say so
   - Don't suggest over-engineering for marginal gains

**IMPORTANT**: When a diff is provided, focus your review on the CHANGED lines shown in the diff. Pre-existing complexity is context, not the primary target. If the complexity was introduced or worsened in this PR, say so. If it's pre-existing, note that and suggest improvements the author could make while they're already in the file.

Be direct and specific to THIS code. Avoid generic advice like "break into smaller functions."

**Example of a good comment:**
"${getExampleForPrimaryMetric(violations)}"

Write comments of similar quality and specificity for each violation below.

IMPORTANT: Do NOT include headers like "Complexity: X" or emojis - we add those.

**GitHub Suggestions**: When the fix is small and self-contained (< 10 lines, replaces specific lines visible in the diff), include a GitHub suggestion block:
\`\`\`suggestion
// replacement code
\`\`\`
Only use suggestion blocks when the replacement is complete, runnable code \u2014 not pseudocode. GitHub renders these as one-click apply buttons.

## Response Format

Respond with ONLY valid JSON. Each key is "filepath::symbolName", value is the comment text.
Use \\n for newlines within comments.

\`\`\`json
{
${jsonKeys}
}
\`\`\``;
}
var CATEGORY_INFO = {
  breaking_change: {
    label: "Breaking Change",
    instruction: "An exported symbol was removed or renamed. Verify this is intentional and note the downstream impact."
  },
  unchecked_return: {
    label: "Unchecked Return Value",
    instruction: "A function call return value is not captured. Determine if ignoring it could lead to silent failures or data loss."
  },
  missing_tests: {
    label: "Missing Test Coverage",
    instruction: "A high-risk function (many dependents, high complexity) has no associated test files. Assess whether this is a testing gap."
  }
};
function buildFindingSection(index, finding, report) {
  const info2 = CATEGORY_INFO[finding.category] || {
    label: finding.category,
    instruction: ""
  };
  const fileData = report.files[finding.filepath];
  const dependentInfo = fileData?.dependentCount ? `
- **Dependents**: ${fileData.dependentCount} file(s)` : "";
  const riskInfo = fileData?.riskLevel ? `
- **Risk level**: ${fileData.riskLevel}` : "";
  const testInfo = fileData?.testAssociations?.length ? `
- **Test files**: ${fileData.testAssociations.join(", ")}` : "\n- **Tests**: None found";
  return `### ${index}. [${info2.label}] ${finding.filepath}::${finding.symbolName} (line ${finding.line})
- **Category**: ${info2.label}
- **Severity**: ${finding.severity}
- **Evidence**: ${finding.evidence}${dependentInfo}${riskInfo}${testInfo}

${info2.instruction}`;
}
function buildLogicReviewPrompt(findings, codeSnippets, report, diffHunks) {
  const findingSections = findings.map((finding, i) => {
    let section = buildFindingSection(i + 1, finding, report);
    const snippetKey = `${finding.filepath}::${finding.symbolName}`;
    const snippet = codeSnippets.get(snippetKey);
    if (snippet) {
      section += `

**Code:**
\`\`\`
${snippet}
\`\`\``;
    }
    const hunk = diffHunks?.get(snippetKey);
    if (hunk) {
      section += `

**Diff:**
\`\`\`diff
${hunk}
\`\`\``;
    }
    return section;
  }).join("\n\n");
  const jsonKeys = findings.map(
    (f) => `  "${f.filepath}::${f.symbolName}": { "valid": true, "comment": "...", "category": "${f.category}" }`
  ).join(",\n");
  return `You are a senior engineer validating potential code issues detected by static analysis.

## Findings to Validate

${findingSections}

## Instructions

For each finding, determine if it is a **real issue** that warrants a review comment.

- For **breaking changes**: confirm the export was actually removed/renamed and whether dependents will break.
- For **unchecked returns**: confirm the return value matters and ignoring it could cause bugs.
- For **missing tests**: confirm the function is high-risk enough to warrant a test recommendation.

Set \`valid: false\` if the finding is a false positive (e.g., the function is intentionally void, the export was replaced by an equivalent, the function is trivial).

Write concise, actionable comments (2-3 sentences max). Be specific about what the developer should do.

## Response Format

Respond with ONLY valid JSON. Each key is "filepath::symbolName".

\`\`\`json
{
${jsonKeys}
}
\`\`\``;
}
var LogicReviewEntrySchema = external_exports.object({
  valid: external_exports.boolean(),
  comment: external_exports.string(),
  category: external_exports.enum(["breaking_change", "unchecked_return", "missing_tests"])
});
var LogicReviewResponseSchema = external_exports.record(external_exports.string(), LogicReviewEntrySchema);
function extractJsonString(content) {
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (codeBlockMatch ? codeBlockMatch[1] : content).trim();
}
function tryStrictParse(jsonStr) {
  try {
    return LogicReviewResponseSchema.parse(JSON.parse(jsonStr));
  } catch {
    return null;
  }
}
function tryPartialRecovery(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null) return null;
    const partial = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "object" && value !== null && "valid" in value && "comment" in value) {
        const v = value;
        partial[key] = {
          valid: Boolean(v.valid),
          comment: String(v.comment),
          category: String(v.category || "unknown")
        };
      }
    }
    return Object.keys(partial).length > 0 ? partial : null;
  } catch {
    return null;
  }
}
function parseLogicReviewResponse(content, logger) {
  const jsonStr = extractJsonString(content);
  logger.info(`Parsing logic review response (${jsonStr.length} chars)`);
  const strict = tryStrictParse(jsonStr);
  if (strict) {
    logger.info(`Validated ${Object.keys(strict).length} logic review entries`);
    return strict;
  }
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    logger.warning(`Could not parse logic review response:
${content}`);
    return null;
  }
  const recovered = tryStrictParse(objectMatch[0]);
  if (recovered) {
    logger.info(`Recovered ${Object.keys(recovered).length} logic review entries with retry`);
    return recovered;
  }
  const partial = tryPartialRecovery(objectMatch[0]);
  if (partial) {
    logger.info(
      `Partially recovered ${Object.keys(partial).length} entries without strict validation`
    );
    return partial;
  }
  logger.warning(`Could not parse logic review response:
${content}`);
  return null;
}
var OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
var totalUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0
};
function resetTokenUsage() {
  totalUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0
  };
}
function getTokenUsage() {
  return { ...totalUsage };
}
function trackUsage(usage) {
  if (!usage) return;
  totalUsage.promptTokens += usage.prompt_tokens;
  totalUsage.completionTokens += usage.completion_tokens;
  totalUsage.totalTokens += usage.total_tokens;
  totalUsage.cost += usage.cost || 0;
}
function parseCommentsResponse(content, logger) {
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : content).trim();
  logger.info(`Parsing JSON response (${jsonStr.length} chars)`);
  try {
    const parsed = JSON.parse(jsonStr);
    logger.info(`Successfully parsed ${Object.keys(parsed).length} comments`);
    return parsed;
  } catch (parseError) {
    logger.warning(`Initial JSON parse failed: ${parseError}`);
  }
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      logger.info(`Recovered JSON with aggressive parsing: ${Object.keys(parsed).length} comments`);
      return parsed;
    } catch (retryError) {
      logger.warning(`Retry parsing also failed: ${retryError}`);
    }
  }
  logger.warning(`Full response content:
${content}`);
  return null;
}
async function callBatchedCommentsAPI(prompt, apiKey, model) {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/getlien/lien",
      "X-Title": "Veille by Lien"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert code reviewer. Write detailed, actionable comments with specific refactoring suggestions. Respond ONLY with valid JSON. Before suggesting refactorings, analyze the code snippets provided to identify the codebase's architectural patterns (e.g., functions vs classes, module organization, naming conventions). Then suggest refactorings that match those existing patterns."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.3,
      usage: { include: true }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }
  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No response from OpenRouter");
  }
  return data;
}
function mapCommentsToViolations(commentsMap, violations, logger) {
  const results = /* @__PURE__ */ new Map();
  const fallbackMessage = (v) => `This ${v.symbolType} exceeds the complexity threshold. Consider refactoring to improve readability and testability.`;
  if (!commentsMap) {
    for (const violation of violations) {
      results.set(violation, fallbackMessage(violation));
    }
    return results;
  }
  for (const violation of violations) {
    const key = `${violation.filepath}::${violation.symbolName}`;
    const comment = commentsMap[key];
    if (comment) {
      results.set(violation, comment.replace(/\\n/g, "\n"));
    } else {
      logger.warning(`No comment generated for ${key}`);
      results.set(violation, fallbackMessage(violation));
    }
  }
  return results;
}
async function generateLineComments(violations, codeSnippets, apiKey, model, report, logger, diffHunks) {
  if (violations.length === 0) {
    return /* @__PURE__ */ new Map();
  }
  logger.info(`Generating comments for ${violations.length} violations in single batch`);
  const prompt = buildBatchedCommentsPrompt(violations, codeSnippets, report, diffHunks);
  const data = await callBatchedCommentsAPI(prompt, apiKey, model);
  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : "";
    logger.info(
      `Batch tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`
    );
  }
  const commentsMap = parseCommentsResponse(data.choices[0].message.content, logger);
  return mapCommentsToViolations(commentsMap, violations, logger);
}
function mapFindingsToComments(findings, parsed, logger) {
  const comments = [];
  for (const finding of findings) {
    const key = `${finding.filepath}::${finding.symbolName}`;
    const entry = parsed[key];
    if (entry && entry.valid) {
      const categoryLabel = finding.category.replace(/_/g, " ");
      comments.push({
        path: finding.filepath,
        line: finding.line,
        body: `**Logic Review** (beta) \u2014 ${categoryLabel}

${entry.comment}`
      });
    } else if (entry && !entry.valid) {
      logger.info(`Finding ${key} marked as false positive by LLM`);
    }
  }
  return comments;
}
async function generateLogicComments(findings, codeSnippets, apiKey, model, report, logger, diffHunks) {
  if (findings.length === 0) {
    return [];
  }
  logger.info(`Validating ${findings.length} logic findings via LLM`);
  const prompt = buildLogicReviewPrompt(findings, codeSnippets, report, diffHunks);
  const data = await callBatchedCommentsAPI(prompt, apiKey, model);
  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : "";
    logger.info(
      `Logic review tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`
    );
  }
  const parsed = parseLogicReviewResponse(data.choices[0].message.content, logger);
  if (!parsed) {
    logger.warning("Failed to parse logic review response, skipping");
    return [];
  }
  const comments = mapFindingsToComments(findings, parsed, logger);
  logger.info(`${comments.length}/${findings.length} findings validated as real issues`);
  return comments;
}
function detectLogicFindings(chunks, report, baselineReport, categories) {
  const findings = [];
  const enabledCategories = new Set(categories);
  if (enabledCategories.has("breaking_change") && baselineReport) {
    findings.push(...detectBreakingChanges(chunks, report, baselineReport));
  }
  if (enabledCategories.has("unchecked_return")) {
    findings.push(...detectUncheckedReturns(chunks));
  }
  if (enabledCategories.has("missing_tests")) {
    findings.push(...detectMissingTestCoverage(chunks, report));
  }
  return prioritizeFindings(findings, report);
}
function buildExportsMap(chunks) {
  const exports = /* @__PURE__ */ new Map();
  for (const chunk of chunks) {
    if (chunk.metadata.exports && chunk.metadata.exports.length > 0) {
      const existing = exports.get(chunk.metadata.file) || /* @__PURE__ */ new Set();
      for (const exp of chunk.metadata.exports) {
        existing.add(exp);
      }
      exports.set(chunk.metadata.file, existing);
    }
  }
  return exports;
}
function detectBreakingChanges(chunks, report, baselineReport) {
  const findings = [];
  const currentExports = buildExportsMap(chunks);
  for (const [filepath, baseFileData] of Object.entries(baselineReport.files)) {
    const currentFileData = report.files[filepath];
    if (!currentFileData) continue;
    const dependentCount = currentFileData.dependentCount || 0;
    if (dependentCount === 0) continue;
    const baseViolationSymbols = new Set(baseFileData.violations.map((v) => v.symbolName));
    const currentViolationSymbols = new Set(currentFileData.violations.map((v) => v.symbolName));
    const currentFileExports = currentExports.get(filepath) || /* @__PURE__ */ new Set();
    for (const symbol of baseViolationSymbols) {
      if (!currentViolationSymbols.has(symbol) && !currentFileExports.has(symbol)) {
        findings.push({
          filepath,
          symbolName: symbol,
          line: 1,
          category: "breaking_change",
          severity: "error",
          message: `Exported symbol \`${symbol}\` was removed or renamed. ${dependentCount} file(s) depend on this module.`,
          evidence: `Symbol "${symbol}" exists in baseline but not in current. ${dependentCount} dependent(s).`
        });
      }
    }
  }
  return findings;
}
function checkCallSite(chunk, callSite, lines, startLine) {
  const lineIndex = callSite.line - startLine;
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  const lineContent = lines[lineIndex].trim();
  if (!isLikelyUncheckedCall(lineContent, callSite.symbol)) return null;
  return {
    filepath: chunk.metadata.file,
    symbolName: chunk.metadata.symbolName,
    line: callSite.line,
    category: "unchecked_return",
    severity: "warning",
    message: `Return value of \`${callSite.symbol}()\` is not captured. If it returns an error or important data, this could lead to silent failures.`,
    evidence: `Call to "${callSite.symbol}" at line ${callSite.line} appears to discard its return value. Line: "${lineContent}"`
  };
}
function detectUncheckedReturns(chunks) {
  const findings = [];
  for (const chunk of chunks) {
    if (!chunk.metadata.callSites || chunk.metadata.callSites.length === 0) continue;
    if (!chunk.metadata.symbolName) continue;
    const lines = chunk.content.split("\n");
    for (const callSite of chunk.metadata.callSites) {
      const finding = checkCallSite(chunk, callSite, lines, chunk.metadata.startLine);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}
function isLikelyUncheckedCall(lineContent, symbol) {
  if (lineContent.startsWith("return ")) return false;
  if (/^(?:const|let|var|this\.\w+)\s/.test(lineContent)) return false;
  if (/^\w+\s*=/.test(lineContent)) return false;
  const callIndex = lineContent.indexOf(symbol + "(");
  if (callIndex === -1) return false;
  if (lineContent.startsWith("void ")) return false;
  if (lineContent.startsWith("await ") && !lineContent.includes("=")) {
    return true;
  }
  const stripped = lineContent.replace(/^await\s+/, "");
  if (stripped.startsWith(symbol + "(") || stripped.startsWith(`this.${symbol}(`)) {
    return true;
  }
  return false;
}
function detectMissingTestCoverage(chunks, report) {
  const findings = [];
  const seen = /* @__PURE__ */ new Set();
  for (const chunk of chunks) {
    if (!chunk.metadata.symbolName) continue;
    if (chunk.metadata.type !== "function") continue;
    const key = `${chunk.metadata.file}::${chunk.metadata.symbolName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const complexity = chunk.metadata.complexity || 0;
    const fileData = report.files[chunk.metadata.file];
    const dependentCount = fileData?.dependentCount || 0;
    const hasTests = fileData?.testAssociations && fileData.testAssociations.length > 0;
    if (complexity >= 10 && dependentCount >= 3 && !hasTests) {
      findings.push({
        filepath: chunk.metadata.file,
        symbolName: chunk.metadata.symbolName,
        line: chunk.metadata.startLine,
        category: "missing_tests",
        severity: "warning",
        message: `\`${chunk.metadata.symbolName}\` has complexity ${complexity} and ${dependentCount} dependents but no test coverage. This is a high-risk function.`,
        evidence: `Complexity: ${complexity}, Dependents: ${dependentCount}, Test files: none`
      });
    }
  }
  return findings;
}
function prioritizeFindings(findings, report) {
  const MAX_FINDINGS = 15;
  const severityWeight = { error: 10, warning: 5 };
  return findings.sort((a, b) => {
    const fileA = report.files[a.filepath];
    const fileB = report.files[b.filepath];
    const scoreA = (fileA?.dependentCount || 0) * severityWeight[a.severity];
    const scoreB = (fileB?.dependentCount || 0) * severityWeight[b.severity];
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return 0;
  }).slice(0, MAX_FINDINGS);
}
function parseSuppressionComments(code) {
  const results = [];
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/(?:\/\/|#)\s*veille-ignore:\s*(.+)/);
    if (match) {
      const categories = match[1].split(",").map((s) => s.trim().toLowerCase());
      results.push({ line: i + 1, categories });
    }
  }
  return results;
}
function categoryToSuppressionKey(category) {
  return category.replace(/_/g, "-");
}
function isFindingSuppressed(finding, codeSnippet) {
  const suppressions = parseSuppressionComments(codeSnippet);
  if (suppressions.length === 0) return false;
  const findingKey = categoryToSuppressionKey(finding.category);
  for (const suppression of suppressions) {
    const lineDiff = finding.line - suppression.line;
    if (lineDiff < 0 || lineDiff > 1) continue;
    if (suppression.categories.includes("all") || suppression.categories.includes(findingKey)) {
      return true;
    }
  }
  return false;
}
var SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
function sanitizeForLog(value) {
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, "");
  const truncated = cleaned.length > 80 ? cleaned.slice(0, 80) + "..." : cleaned;
  return JSON.stringify(truncated);
}
function assertValidSha(sha, label) {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(
      `Invalid ${label}: must be a 7-40 character hex string, got ${sanitizeForLog(sha)}`
    );
  }
}
function getFunctionKey(filepath, symbolName, metricType) {
  return `${filepath}::${symbolName}::${metricType}`;
}
function buildComplexityMap(report, files) {
  if (!report) return /* @__PURE__ */ new Map();
  const entries = (0, import_collect3.default)(files).map((filepath) => ({ filepath, fileData: report.files[filepath] })).filter(({ fileData }) => !!fileData).flatMap(
    ({ filepath, fileData }) => fileData.violations.map(
      (violation) => [
        getFunctionKey(filepath, violation.symbolName, violation.metricType),
        { complexity: violation.complexity, violation }
      ]
    )
  ).all();
  return new Map(entries);
}
function determineSeverity(baseComplexity, headComplexity, delta, threshold) {
  if (baseComplexity === null) return "new";
  if (delta < 0) return "improved";
  return headComplexity >= threshold * 2 ? "error" : "warning";
}
function createDelta(violation, baseComplexity, headComplexity, severity) {
  const delta = baseComplexity !== null && headComplexity !== null ? headComplexity - baseComplexity : headComplexity ?? -(baseComplexity ?? 0);
  return {
    filepath: violation.filepath,
    symbolName: violation.symbolName,
    symbolType: violation.symbolType,
    startLine: violation.startLine,
    metricType: violation.metricType,
    baseComplexity,
    headComplexity,
    delta,
    threshold: violation.threshold,
    severity
  };
}
var SEVERITY_ORDER = {
  error: 0,
  warning: 1,
  new: 2,
  improved: 3,
  deleted: 4
};
function sortDeltas(deltas) {
  return deltas.sort((a, b) => {
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    return b.delta - a.delta;
  });
}
function processHeadViolations(headMap, baseMap) {
  const seenBaseKeys = /* @__PURE__ */ new Set();
  const deltas = (0, import_collect3.default)(Array.from(headMap.entries())).map(([key, headData]) => {
    const baseData = baseMap.get(key);
    if (baseData) seenBaseKeys.add(key);
    const baseComplexity = baseData?.complexity ?? null;
    const headComplexity = headData.complexity;
    const delta = baseComplexity !== null ? headComplexity - baseComplexity : headComplexity;
    const severity = determineSeverity(
      baseComplexity,
      headComplexity,
      delta,
      headData.violation.threshold
    );
    return createDelta(headData.violation, baseComplexity, headComplexity, severity);
  }).all();
  return { deltas, seenBaseKeys };
}
function calculateDeltas(baseReport, headReport, changedFiles) {
  const baseMap = buildComplexityMap(baseReport, changedFiles);
  const headMap = buildComplexityMap(headReport, changedFiles);
  const { deltas: headDeltas, seenBaseKeys } = processHeadViolations(headMap, baseMap);
  const deletedDeltas = (0, import_collect3.default)(Array.from(baseMap.entries())).filter(([key]) => !seenBaseKeys.has(key)).map(([_, baseData]) => createDelta(baseData.violation, baseData.complexity, null, "deleted")).all();
  return sortDeltas([...headDeltas, ...deletedDeltas]);
}
function calculateDeltaSummary(deltas) {
  const collection = (0, import_collect3.default)(deltas);
  const categorized = collection.map((d) => {
    if (d.severity === "improved") return "improved";
    if (d.severity === "new") return "new";
    if (d.severity === "deleted") return "deleted";
    if (d.delta > 0) return "degraded";
    if (d.delta === 0) return "unchanged";
    return "improved";
  });
  const counts = categorized.countBy().all();
  return {
    totalDelta: collection.sum("delta"),
    improved: counts["improved"] || 0,
    degraded: counts["degraded"] || 0,
    newFunctions: counts["new"] || 0,
    deletedFunctions: counts["deleted"] || 0,
    unchanged: counts["unchanged"] || 0
  };
}
function formatDelta(delta) {
  if (delta > 0) return `+${delta} \u2B06\uFE0F`;
  if (delta < 0) return `${delta} \u2B07\uFE0F`;
  return "\xB10";
}
function formatSeverityEmoji(severity) {
  switch (severity) {
    case "error":
      return "\u{1F534}";
    case "warning":
      return "\u{1F7E1}";
    case "improved":
      return "\u{1F7E2}";
    case "new":
      return "\u{1F195}";
    case "deleted":
      return "\u{1F5D1}\uFE0F";
  }
}
function logDeltaSummary(summary, logger) {
  const sign = summary.totalDelta >= 0 ? "+" : "";
  logger.info(`Complexity delta: ${sign}${summary.totalDelta}`);
  logger.info(`  Degraded: ${summary.degraded}, Improved: ${summary.improved}`);
  logger.info(`  New: ${summary.newFunctions}, Deleted: ${summary.deletedFunctions}`);
}
function filterAnalyzableFiles(files) {
  const codeExtensions = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".php"]);
  const excludePatterns = [
    /node_modules\//,
    /vendor\//,
    /dist\//,
    /build\//,
    /\.min\./,
    /\.bundle\./,
    /\.generated\./,
    /package-lock\.json/,
    /yarn\.lock/,
    /pnpm-lock\.yaml/
  ];
  return files.filter((file) => {
    const ext = file.slice(file.lastIndexOf("."));
    if (!codeExtensions.has(ext)) {
      return false;
    }
    for (const pattern of excludePatterns) {
      if (pattern.test(file)) {
        return false;
      }
    }
    return true;
  });
}
async function getFilesToAnalyze(octokit, prContext, logger) {
  const allChangedFiles = await getPRChangedFiles(octokit, prContext);
  logger.info(`Found ${allChangedFiles.length} changed files in PR`);
  const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
  logger.info(`${filesToAnalyze.length} files eligible for complexity analysis`);
  return filesToAnalyze;
}
async function runComplexityAnalysis(files, threshold, rootDir, logger) {
  if (files.length === 0) {
    logger.info("No files to analyze");
    return null;
  }
  try {
    logger.info(`Indexing ${files.length} files (chunk-only)...`);
    const indexResult = await indexCodebase({ rootDir, skipEmbeddings: true, filesToIndex: files });
    logger.info(
      `Indexing complete: ${indexResult.chunksCreated} chunks from ${indexResult.filesIndexed} files (success: ${indexResult.success})`
    );
    if (!indexResult.success || !indexResult.chunks || indexResult.chunks.length === 0) {
      logger.warning(`Indexing produced no chunks for ${rootDir}`);
      return null;
    }
    logger.info("Analyzing complexity...");
    const report = ComplexityAnalyzer.analyzeFromChunks(indexResult.chunks, files);
    logger.info(`Found ${report.summary.totalViolations} violations`);
    return { report, chunks: indexResult.chunks };
  } catch (error2) {
    logger.error(`Failed to run complexity analysis: ${error2}`);
    return null;
  }
}
function prioritizeViolations(violations, report) {
  return violations.sort((a, b) => {
    const fileA = report.files[a.filepath];
    const fileB = report.files[b.filepath];
    const impactA = (fileA?.dependentCount || 0) * 10 + RISK_ORDER[fileA?.riskLevel || "low"];
    const impactB = (fileB?.dependentCount || 0) * 10 + RISK_ORDER[fileB?.riskLevel || "low"];
    if (impactB !== impactA) return impactB - impactA;
    const severityOrder = { error: 2, warning: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
}
async function prepareViolationsForReview(report, octokit, prContext, logger) {
  const allViolations = Object.values(report.files).flatMap((fileData) => fileData.violations);
  const violations = prioritizeViolations(allViolations, report).slice(0, 10);
  const codeSnippets = /* @__PURE__ */ new Map();
  for (const violation of violations) {
    const snippet = await getFileContent(
      octokit,
      prContext,
      violation.filepath,
      violation.startLine,
      violation.endLine,
      logger
    );
    if (snippet) {
      codeSnippets.set(getViolationKey(violation), snippet);
    }
  }
  logger.info(`Collected ${codeSnippets.size} code snippets for review`);
  return { violations, codeSnippets };
}
function loadBaselineComplexity(path, logger) {
  if (!path) {
    logger.info("No baseline complexity path provided, skipping delta calculation");
    return null;
  }
  try {
    if (!fs.existsSync(path)) {
      logger.warning(`Baseline complexity file not found: ${path}`);
      return null;
    }
    const content = fs.readFileSync(path, "utf-8");
    const report = JSON.parse(content);
    if (!report.files || !report.summary) {
      logger.warning("Baseline complexity file has invalid format");
      return null;
    }
    logger.info(`Loaded baseline complexity: ${report.summary.totalViolations} violations`);
    return report;
  } catch (error2) {
    logger.warning(`Failed to load baseline complexity: ${error2}`);
    return null;
  }
}
async function analyzeBaseBranch(baseSha, filesToAnalyze, threshold, rootDir, logger) {
  const originalHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
  try {
    logger.info(`Checking out base branch at ${baseSha.substring(0, 7)}...`);
    assertValidSha(baseSha, "baseSha");
    execFileSync("git", ["checkout", "--force", baseSha], { stdio: "pipe" });
    logger.info("Base branch checked out");
    logger.info("Analyzing base branch complexity...");
    const baseResult = await runComplexityAnalysis(filesToAnalyze, threshold, rootDir, logger);
    const baseReport = baseResult?.report ?? null;
    execFileSync("git", ["checkout", "--force", originalHead], { stdio: "pipe" });
    logger.info("Restored to HEAD");
    if (baseReport) {
      logger.info(`Base branch: ${baseReport.summary.totalViolations} violations`);
    }
    return baseReport;
  } catch (error2) {
    logger.warning(`Failed to analyze base branch: ${error2}`);
    try {
      execFileSync("git", ["checkout", "--force", originalHead], { stdio: "pipe" });
    } catch (restoreError) {
      logger.warning(`Failed to restore HEAD: ${restoreError}`);
    }
    return null;
  }
}
async function getBaselineReport(config, prContext, filesToAnalyze, rootDir, logger) {
  if (config.enableDeltaTracking) {
    logger.info("Delta tracking enabled - analyzing base branch...");
    return await analyzeBaseBranch(
      prContext.baseSha,
      filesToAnalyze,
      config.threshold,
      rootDir,
      logger
    );
  }
  if (config.baselineComplexityPath) {
    logger.warning(
      "baseline_complexity input is deprecated. Use enable_delta_tracking: true instead."
    );
    return loadBaselineComplexity(config.baselineComplexityPath, logger);
  }
  return null;
}
async function orchestrateAnalysis(setup) {
  const { config, prContext, octokit, logger, rootDir } = setup;
  const filesToAnalyze = await getFilesToAnalyze(octokit, prContext, logger);
  if (filesToAnalyze.length === 0) {
    logger.info("No analyzable files found, skipping review");
    return null;
  }
  const baselineReport = await getBaselineReport(
    config,
    prContext,
    filesToAnalyze,
    rootDir,
    logger
  );
  const analysisResult = await runComplexityAnalysis(
    filesToAnalyze,
    config.threshold,
    rootDir,
    logger
  );
  if (!analysisResult) {
    logger.warning("Failed to get complexity report");
    return null;
  }
  const { report: currentReport, chunks } = analysisResult;
  logger.info(`Analysis complete: ${currentReport.summary.totalViolations} violations found`);
  const deltas = baselineReport ? calculateDeltas(baselineReport, currentReport, filesToAnalyze) : null;
  return {
    currentReport,
    baselineReport,
    deltas,
    filesToAnalyze,
    chunks
  };
}
async function handleAnalysisOutputs(result, setup) {
  const { octokit, prContext, logger } = setup;
  const deltaSummary = result.deltas ? calculateDeltaSummary(result.deltas) : null;
  if (deltaSummary) {
    logDeltaSummary(deltaSummary, logger);
  }
  const badge = buildDescriptionBadge(result.currentReport, deltaSummary, result.deltas);
  await updatePRDescription(octokit, prContext, badge, logger);
  return deltaSummary;
}
function findCommentLine(violation, diffLines) {
  const fileLines = diffLines.get(violation.filepath);
  if (!fileLines) return null;
  if (fileLines.has(violation.startLine)) {
    return violation.startLine;
  }
  for (let line = violation.startLine; line <= violation.endLine; line++) {
    if (fileLines.has(line)) {
      return line;
    }
  }
  return null;
}
function createDeltaKey(v) {
  return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}
function inRange(line, start, end) {
  return line >= start && line <= end;
}
function isLineRelevant(patchLine) {
  return patchLine.startsWith("+") ? !patchLine.startsWith("+++") : patchLine.startsWith(" ");
}
function extractRelevantHunk(patch, startLine, endLine) {
  const lines = [];
  let currentLine = 0;
  for (const patchLine of patch.split("\n")) {
    const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }
    if (patchLine.startsWith("-")) {
      if (inRange(currentLine, startLine, endLine)) lines.push(patchLine);
      continue;
    }
    if (isLineRelevant(patchLine)) {
      if (inRange(currentLine, startLine, endLine)) lines.push(patchLine);
      currentLine++;
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
function buildDiffHunks(patches, violations) {
  const diffHunks = /* @__PURE__ */ new Map();
  for (const v of violations) {
    const key = `${v.filepath}::${v.symbolName}`;
    if (diffHunks.has(key)) continue;
    const patch = patches.get(v.filepath);
    if (!patch) continue;
    const hunk = extractRelevantHunk(patch, v.startLine, v.endLine);
    if (hunk) {
      diffHunks.set(key, hunk);
    }
  }
  return diffHunks;
}
function buildDeltaMap(deltas) {
  if (!deltas) return /* @__PURE__ */ new Map();
  return new Map(
    (0, import_collect.default)(deltas).map((d) => [createDeltaKey(d), d]).all()
  );
}
function getMetricEmoji2(metricType) {
  switch (metricType) {
    case "cyclomatic":
      return "\u{1F500}";
    case "cognitive":
      return "\u{1F9E0}";
    case "halstead_effort":
      return "\u23F1\uFE0F";
    case "halstead_bugs":
      return "\u{1F41B}";
    default:
      return "\u{1F4CA}";
  }
}
function formatUncoveredLine(v, deltaMap) {
  const delta = deltaMap.get(createDeltaKey(v));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
  const emoji = getMetricEmoji2(v.metricType);
  const metricLabel = getMetricLabel(v.metricType || "cyclomatic");
  const valueDisplay = formatComplexityValue(v.metricType || "cyclomatic", v.complexity);
  return `* \`${v.symbolName}\` in \`${v.filepath}\`: ${emoji} ${metricLabel} ${valueDisplay}${deltaStr}`;
}
var BOY_SCOUT_LINK = "[boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)";
function categorizeUncoveredViolations(violations, deltaMap) {
  const newOrWorsened = violations.filter((v) => {
    const delta = deltaMap.get(createDeltaKey(v));
    return delta && (delta.severity === "new" || delta.delta > 0);
  });
  const preExisting = violations.filter((v) => {
    const delta = deltaMap.get(createDeltaKey(v));
    return !delta || delta.delta === 0;
  });
  return { newOrWorsened, preExisting };
}
function buildNewWorsenedSection(violations, deltaMap) {
  if (violations.length === 0) return "";
  const list = violations.map((v) => formatUncoveredLine(v, deltaMap)).join("\n");
  return `

\u26A0\uFE0F **${violations.length} new/worsened violation${violations.length === 1 ? "" : "s"} outside diff:**

${list}`;
}
function buildPreExistingSection(violations, deltaMap) {
  if (violations.length === 0) return "";
  const list = violations.map((v) => formatUncoveredLine(v, deltaMap)).join("\n");
  return `

<details>
<summary>\u2139\uFE0F ${violations.length} pre-existing violation${violations.length === 1 ? "" : "s"} outside diff</summary>

${list}

> *These violations existed before this PR. No action required, but consider the ${BOY_SCOUT_LINK}!*

</details>`;
}
function buildFallbackUncoveredSection(violations, deltaMap) {
  const list = violations.map((v) => formatUncoveredLine(v, deltaMap)).join("\n");
  return `

<details>
<summary>\u26A0\uFE0F ${violations.length} violation${violations.length === 1 ? "" : "s"} outside diff (no inline comment)</summary>

${list}

> \u{1F4A1} *These exist in files touched by this PR but the function declarations aren't in the diff. Consider the ${BOY_SCOUT_LINK}!*

</details>`;
}
function buildUncoveredNote(uncoveredViolations, deltaMap) {
  if (uncoveredViolations.length === 0) return "";
  const { newOrWorsened, preExisting } = categorizeUncoveredViolations(
    uncoveredViolations,
    deltaMap
  );
  if (newOrWorsened.length === 0 && preExisting.length === 0) {
    return buildFallbackUncoveredSection(uncoveredViolations, deltaMap);
  }
  return buildNewWorsenedSection(newOrWorsened, deltaMap) + buildPreExistingSection(preExisting, deltaMap);
}
function buildSkippedNote(skippedViolations) {
  if (skippedViolations.length === 0) return "";
  const skippedList = skippedViolations.map((v) => `  - \`${v.symbolName}\` in \`${v.filepath}\`: complexity ${v.complexity}`).join("\n");
  return `

<details>
<summary>\u2139\uFE0F ${skippedViolations.length} pre-existing violation${skippedViolations.length === 1 ? "" : "s"} (unchanged)</summary>

${skippedList}

> *These violations existed before this PR and haven't changed. No inline comments added to reduce noise.*

</details>`;
}
function formatCostDisplay(usage) {
  return usage.totalTokens > 0 ? `
- Tokens: ${usage.totalTokens.toLocaleString()} ($${usage.cost.toFixed(4)})` : "";
}
function groupDeltasByMetric(deltas) {
  return (0, import_collect.default)(deltas).groupBy("metricType").map((group) => group.sum("delta")).all();
}
function buildMetricBreakdown(deltaByMetric) {
  const metricOrder = ["cyclomatic", "cognitive", "halstead_effort", "halstead_bugs"];
  return (0, import_collect.default)(metricOrder).map((metricType) => {
    const metricDelta = deltaByMetric[metricType] || 0;
    const emoji = getMetricEmoji2(metricType);
    const sign = metricDelta >= 0 ? "+" : "";
    return `${emoji} ${sign}${formatDeltaValue(metricType, metricDelta)}`;
  }).all().join(" | ");
}
function formatDeltaDisplay(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const deltaSummary = calculateDeltaSummary(deltas);
  const deltaByMetric = groupDeltasByMetric(deltas);
  if (deltaSummary.totalDelta === 0 && deltaSummary.improved === 0 && deltaSummary.newFunctions === 0) {
    return "\n\n**Complexity:** No change from this PR.";
  }
  const metricBreakdown = buildMetricBreakdown(deltaByMetric);
  const trend = deltaSummary.totalDelta > 0 ? "\u2B06\uFE0F" : deltaSummary.totalDelta < 0 ? "\u2B07\uFE0F" : "\u27A1\uFE0F";
  let display = `

**Complexity Change:** ${metricBreakdown} ${trend}`;
  if (deltaSummary.improved > 0) display += ` (${deltaSummary.improved} improved)`;
  if (deltaSummary.degraded > 0) display += ` (${deltaSummary.degraded} degraded)`;
  return display;
}
function buildReviewSummary(report, deltas, uncoveredNote) {
  const { summary } = report;
  const costDisplay = formatCostDisplay(getTokenUsage());
  const deltaDisplay = formatDeltaDisplay(deltas);
  const headerLine = buildHeaderLine(summary.totalViolations, deltas);
  return `<!-- lien-ai-review -->
## \u{1F441}\uFE0F Veille

${headerLine}${deltaDisplay}

See inline comments on the diff for specific suggestions.${uncoveredNote}

<details>
<summary>\u{1F4CA} Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${costDisplay}

</details>

*[Veille](https://lien.dev) by Lien*`;
}
function getMetricEmojiForComment(metricType) {
  switch (metricType) {
    case "cyclomatic":
      return "\u{1F500}";
    case "cognitive":
      return "\u{1F9E0}";
    case "halstead_effort":
      return "\u23F1\uFE0F";
    case "halstead_bugs":
      return "\u{1F41B}";
    default:
      return "\u{1F4CA}";
  }
}
function formatMetricHeaderLine(violation, deltaMap) {
  const metricType = violation.metricType || "cyclomatic";
  const delta = deltaMap.get(createDeltaKey(violation));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
  const severityEmoji = delta ? formatSeverityEmoji(delta.severity) : violation.severity === "error" ? "\u{1F534}" : "\u{1F7E1}";
  const emoji = getMetricEmojiForComment(metricType);
  const metricLabel = getMetricLabel(metricType);
  const valueDisplay = formatComplexityValue(metricType, violation.complexity);
  const thresholdDisplay = formatThresholdValue(metricType, violation.threshold);
  return `${severityEmoji} ${emoji} **${metricLabel.charAt(0).toUpperCase() + metricLabel.slice(1)}: ${valueDisplay}**${deltaStr} (threshold: ${thresholdDisplay})`;
}
function buildGroupedCommentBody(group, aiComments, deltaMap, report) {
  const firstViolation = group[0].violation;
  const { commentLine } = group[0];
  const metricHeaders = group.map(({ violation }) => formatMetricHeaderLine(violation, deltaMap)).join("\n");
  const lineNote = commentLine !== firstViolation.startLine ? ` *(\`${firstViolation.symbolName}\` starts at line ${firstViolation.startLine})*` : "";
  const comment = aiComments.get(firstViolation);
  const fileData = report.files[firstViolation.filepath];
  const testNote = fileData && (!fileData.testAssociations || fileData.testAssociations.length === 0) ? "\n\n> No test files found for this function." : "";
  return `${metricHeaders}${lineNote}

${comment}${testNote}`;
}
function buildLineComments(violationsWithLines, aiComments, deltaMap, report, logger) {
  const grouped = /* @__PURE__ */ new Map();
  for (const entry of violationsWithLines) {
    if (!aiComments.has(entry.violation)) continue;
    const key = `${entry.violation.filepath}::${entry.violation.symbolName}`;
    const existing = grouped.get(key) || [];
    existing.push(entry);
    grouped.set(key, existing);
  }
  const comments = [];
  for (const [, group] of grouped) {
    const firstViolation = group[0].violation;
    logger.info(
      `Adding grouped comment for ${firstViolation.filepath}:${group[0].commentLine} (${firstViolation.symbolName}, ${group.length} metric${group.length === 1 ? "" : "s"})`
    );
    comments.push({
      path: firstViolation.filepath,
      line: group[0].commentLine,
      body: buildGroupedCommentBody(group, aiComments, deltaMap, report)
    });
  }
  return comments;
}
function partitionViolationsByDiff(violations, diffLines) {
  const withLines = [];
  const uncovered = [];
  for (const v of violations) {
    const commentLine = findCommentLine(v, diffLines);
    if (commentLine !== null) {
      withLines.push({ violation: v, commentLine });
    } else {
      uncovered.push(v);
    }
  }
  return { withLines, uncovered };
}
function filterNewOrDegraded(violationsWithLines, deltaMap) {
  return violationsWithLines.filter(({ violation }) => {
    const key = createDeltaKey(violation);
    const delta = deltaMap.get(key);
    return !delta || delta.severity === "new" || delta.delta > 0;
  });
}
function getSkippedViolations(violationsWithLines, deltaMap) {
  return violationsWithLines.filter(({ violation }) => {
    const key = createDeltaKey(violation);
    const delta = deltaMap.get(key);
    return delta && delta.severity !== "new" && delta.delta === 0;
  }).map((v) => v.violation);
}
function processViolationsForReview(violations, diffLines, deltaMap) {
  const { withLines, uncovered } = partitionViolationsByDiff(violations, diffLines);
  const newOrDegraded = filterNewOrDegraded(withLines, deltaMap);
  const skipped = getSkippedViolations(withLines, deltaMap);
  return { withLines, uncovered, newOrDegraded, skipped };
}
async function handleNoNewViolations(octokit, prContext, violationsWithLines, uncoveredViolations, deltaMap, report, deltas, logger) {
  if (violationsWithLines.length === 0) {
    return;
  }
  const skippedInDiff = getSkippedViolations(violationsWithLines, deltaMap);
  const uncoveredNote = buildUncoveredNote(uncoveredViolations, deltaMap);
  const skippedNote = buildSkippedNote(skippedInDiff);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);
  await postPRComment(octokit, prContext, summaryBody, logger);
}
async function generateAndPostReview(octokit, prContext, processed, deltaMap, codeSnippets, config, report, deltas, logger, diffHunks) {
  const commentableViolations = processed.newOrDegraded.map((v) => v.violation);
  logger.info(
    `Generating AI comments for ${commentableViolations.length} new/degraded violations...`
  );
  const aiComments = await generateLineComments(
    commentableViolations,
    codeSnippets,
    config.openrouterApiKey,
    config.model,
    report,
    logger,
    diffHunks
  );
  const lineComments = buildLineComments(
    processed.newOrDegraded,
    aiComments,
    deltaMap,
    report,
    logger
  );
  logger.info(`Built ${lineComments.length} line comments for new/degraded violations`);
  const uncoveredNote = buildUncoveredNote(processed.uncovered, deltaMap);
  const skippedNote = buildSkippedNote(processed.skipped);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);
  const hasNewErrors = config.blockOnNewErrors && processed.newOrDegraded.some(({ violation }) => {
    const delta = deltaMap.get(createDeltaKey(violation));
    return violation.severity === "error" && (!delta || delta.severity === "new" || delta.delta > 0);
  });
  const event = hasNewErrors ? "REQUEST_CHANGES" : "COMMENT";
  if (hasNewErrors) {
    logger.info("New error-level violations detected \u2014 posting REQUEST_CHANGES review");
  }
  await postPRReview(octokit, prContext, lineComments, summaryBody, logger, event);
  logger.info(`Posted review with ${lineComments.length} line comments`);
}
async function postLineReview(octokit, prContext, report, violations, codeSnippets, config, logger, deltas = null) {
  const { diffLines, patches } = await getPRPatchData(octokit, prContext);
  logger.info(`Diff covers ${diffLines.size} files`);
  const deltaMap = buildDeltaMap(deltas);
  const processed = processViolationsForReview(violations, diffLines, deltaMap);
  logger.info(
    `${processed.withLines.length}/${violations.length} violations can have inline comments (${processed.uncovered.length} outside diff)`
  );
  const skippedCount = processed.withLines.length - processed.newOrDegraded.length;
  if (skippedCount > 0) {
    logger.info(`Skipping ${skippedCount} unchanged pre-existing violations (no LLM calls needed)`);
  }
  if (processed.newOrDegraded.length === 0) {
    logger.info("No new or degraded violations to comment on");
    await handleNoNewViolations(
      octokit,
      prContext,
      processed.withLines,
      processed.uncovered,
      deltaMap,
      report,
      deltas,
      logger
    );
    return;
  }
  const commentableViolations = processed.newOrDegraded.map((v) => v.violation);
  const diffHunks = buildDiffHunks(patches, commentableViolations);
  logger.info(`Extracted diff hunks for ${diffHunks.size} functions`);
  await generateAndPostReview(
    octokit,
    prContext,
    processed,
    deltaMap,
    codeSnippets,
    config,
    report,
    deltas,
    logger,
    diffHunks
  );
}
function buildChunkSnippetsMap(chunks) {
  const snippets = /* @__PURE__ */ new Map();
  for (const chunk of chunks) {
    if (chunk.metadata.symbolName) {
      snippets.set(`${chunk.metadata.file}::${chunk.metadata.symbolName}`, chunk.content);
    }
  }
  return snippets;
}
async function runLogicReviewPass(result, setup) {
  const { config, prContext, octokit, logger } = setup;
  logger.info("Running logic review (beta)...");
  try {
    const snippetsMap = buildChunkSnippetsMap(result.chunks);
    let logicFindings = detectLogicFindings(
      result.chunks,
      result.currentReport,
      result.baselineReport,
      config.logicReviewCategories
    );
    logicFindings = logicFindings.filter((finding) => {
      const key = `${finding.filepath}::${finding.symbolName}`;
      const snippet = snippetsMap.get(key);
      if (snippet && isFindingSuppressed(finding, snippet)) {
        logger.info(`Suppressed finding: ${key} (${finding.category})`);
        return false;
      }
      return true;
    });
    if (logicFindings.length === 0) {
      logger.info("No logic findings to report");
      return;
    }
    logger.info(`${logicFindings.length} logic findings after filtering`);
    const logicCodeSnippets = /* @__PURE__ */ new Map();
    for (const finding of logicFindings) {
      const key = `${finding.filepath}::${finding.symbolName}`;
      const snippet = snippetsMap.get(key);
      if (snippet) logicCodeSnippets.set(key, snippet);
    }
    const validatedComments = await generateLogicComments(
      logicFindings,
      logicCodeSnippets,
      config.openrouterApiKey,
      config.model,
      result.currentReport,
      logger
    );
    if (validatedComments.length > 0) {
      logger.info(`Posting ${validatedComments.length} logic review comments`);
      await postPRReview(
        octokit,
        prContext,
        validatedComments,
        "**Logic Review** (beta) \u2014 see inline comments.",
        logger
      );
    }
  } catch (error2) {
    logger.warning(`Logic review failed (non-blocking): ${error2}`);
  }
}
async function postReviewIfNeeded(result, setup) {
  const { config, prContext, octokit, logger } = setup;
  if (result.currentReport.summary.totalViolations === 0) {
    logger.info("No complexity violations found");
    const successMessage = buildNoViolationsMessage(prContext, result.deltas);
    await postPRComment(octokit, prContext, successMessage, logger);
    return;
  }
  const { violations, codeSnippets } = await prepareViolationsForReview(
    result.currentReport,
    octokit,
    prContext,
    logger
  );
  resetTokenUsage();
  await postLineReview(
    octokit,
    prContext,
    result.currentReport,
    violations,
    codeSnippets,
    config,
    logger,
    result.deltas
  );
  if (config.enableLogicReview && result.chunks.length > 0) {
    await runLogicReviewPass(result, setup);
  }
}

// src/index.ts
var actionsLogger = {
  info: (msg) => core.info(msg),
  warning: (msg) => core.warning(msg),
  error: (msg) => core.error(msg),
  debug: (msg) => core.debug(msg)
};
function getConfig() {
  return {
    openrouterApiKey: core.getInput("openrouter_api_key", { required: true }),
    model: core.getInput("model") || "anthropic/claude-sonnet-4",
    threshold: core.getInput("threshold") || "15",
    enableDeltaTracking: core.getInput("enable_delta_tracking") === "true",
    baselineComplexityPath: core.getInput("baseline_complexity") || "",
    blockOnNewErrors: core.getInput("block_on_new_errors") === "true",
    enableLogicReview: core.getInput("enable_logic_review") === "true",
    logicReviewCategories: (core.getInput("logic_review_categories") || "breaking_change,unchecked_return,missing_tests").split(",").map((s) => s.trim())
  };
}
function getPRContext() {
  const { context } = github;
  if (!context.payload.pull_request) {
    core.warning("This action only works on pull_request events");
    return null;
  }
  const pr = context.payload.pull_request;
  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pullNumber: pr.number,
    title: pr.title,
    baseSha: pr.base.sha,
    headSha: pr.head.sha
  };
}
function setOutputs(deltaSummary, report) {
  if (deltaSummary) {
    core.setOutput("total_delta", deltaSummary.totalDelta);
    core.setOutput("improved", deltaSummary.improved);
    core.setOutput("degraded", deltaSummary.degraded);
  }
  core.setOutput("violations", report.summary.totalViolations);
  core.setOutput("errors", report.summary.bySeverity.error);
  core.setOutput("warnings", report.summary.bySeverity.warning);
}
async function run() {
  try {
    core.info("Starting Lien AI Code Review...");
    core.info(`Node version: ${process.version}`);
    core.info(`Working directory: ${process.cwd()}`);
    const config = getConfig();
    core.info(`Using model: ${config.model}`);
    core.info(`Complexity threshold: ${config.threshold}`);
    const githubToken = core.getInput("github_token") || process.env.GITHUB_TOKEN || "";
    if (!githubToken) {
      throw new Error("GitHub token is required");
    }
    const prContext = getPRContext();
    if (!prContext) {
      core.info("Not running in PR context, exiting gracefully");
      return;
    }
    core.info(`Reviewing PR #${prContext.pullNumber}: ${prContext.title}`);
    const octokit = createOctokit(githubToken);
    const setup = {
      config,
      prContext,
      octokit,
      logger: actionsLogger,
      rootDir: process.cwd()
    };
    const analysisResult = await orchestrateAnalysis(setup);
    if (!analysisResult) {
      return;
    }
    const deltaSummary = await handleAnalysisOutputs(analysisResult, setup);
    setOutputs(deltaSummary, analysisResult.currentReport);
    await postReviewIfNeeded(analysisResult, setup);
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : "An unexpected error occurred";
    const stack = error2 instanceof Error ? error2.stack : "";
    core.error(`Action failed: ${message}`);
    if (stack) {
      core.error(`Stack trace:
${stack}`);
    }
    core.setFailed(message);
  }
}
run().catch((error2) => {
  core.setFailed(error2 instanceof Error ? error2.message : String(error2));
  process.exit(1);
});
//# sourceMappingURL=index.js.map