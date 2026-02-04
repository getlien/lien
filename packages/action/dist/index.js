var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
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
var import_collect3 = __toESM(require_dist(), 1);
import * as fs from "fs";
import { execSync } from "child_process";
import {
  indexCodebase,
  createVectorDB,
  ComplexityAnalyzer,
  RISK_ORDER
} from "@liendev/core";
import { Octokit } from "@octokit/rest";
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
      const content = Buffer.from(response.data.content, "base64").toString(
        "utf-8"
      );
      const lines = content.split("\n");
      const snippet = lines.slice(startLine - 1, endLine).join("\n");
      return snippet;
    }
  } catch (error2) {
    logger.warning(`Failed to get content for ${filepath}: ${error2}`);
  }
  return null;
}
async function postPRReview(octokit, prContext, comments, summaryBody, logger) {
  if (comments.length === 0) {
    await postPRComment(octokit, prContext, summaryBody, logger);
    return;
  }
  logger.info(`Creating review with ${comments.length} line comments`);
  try {
    await octokit.pulls.createReview({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      commit_id: prContext.headSha,
      event: "COMMENT",
      // Don't approve or request changes, just comment
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
async function getPRDiffLines(octokit, prContext) {
  const diffLines = /* @__PURE__ */ new Map();
  const iterator = octokit.paginate.iterator(octokit.pulls.listFiles, {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    per_page: 100
  });
  for await (const response of iterator) {
    for (const file of response.data) {
      if (!file.patch) continue;
      const lines = parsePatchLines(file.patch);
      if (lines.size > 0) {
        diffLines.set(file.filename, lines);
      }
    }
  }
  return diffLines;
}
function getFunctionKey(filepath, symbolName, metricType) {
  return `${filepath}::${symbolName}::${metricType}`;
}
function buildComplexityMap(report, files) {
  if (!report) return /* @__PURE__ */ new Map();
  const entries = (0, import_collect3.default)(files).map((filepath) => ({ filepath, fileData: report.files[filepath] })).filter(({ fileData }) => !!fileData).flatMap(
    ({ filepath, fileData }) => fileData.violations.map((violation) => [
      getFunctionKey(filepath, violation.symbolName, violation.metricType),
      { complexity: violation.complexity, violation }
    ])
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
    const severity = determineSeverity(baseComplexity, headComplexity, delta, headData.violation.threshold);
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
function createDeltaKey(v) {
  return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}
function buildDeltaMap(deltas) {
  if (!deltas) return /* @__PURE__ */ new Map();
  return new Map(
    (0, import_collect2.default)(deltas).map((d) => [createDeltaKey(d), d]).all()
  );
}
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
function formatViolationLine(v, deltaMap) {
  const delta = deltaMap.get(createDeltaKey(v));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
  const metricLabel = getMetricLabel(v.metricType);
  const valueDisplay = formatComplexityValue(v.metricType, v.complexity);
  const thresholdDisplay = formatThresholdValue(v.metricType, v.threshold);
  return `  - ${v.symbolName} (${v.symbolType}): ${metricLabel} ${valueDisplay}${deltaStr} (threshold: ${thresholdDisplay}) [${v.severity}]`;
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
  "typescript": "TypeScript",
  "javascript": "JavaScript",
  "php": "PHP",
  "python": "Python",
  "go": "Go",
  "rust": "Rust",
  "java": "Java",
  "ruby": "Ruby",
  "swift": "Swift",
  "kotlin": "Kotlin",
  "csharp": "C#",
  "scala": "Scala",
  "cpp": "C++",
  "c": "C"
};
var EXTENSION_LANGUAGES = {
  "ts": "TypeScript",
  "tsx": "TypeScript React",
  "js": "JavaScript",
  "jsx": "JavaScript React",
  "mjs": "JavaScript",
  "cjs": "JavaScript",
  "php": "PHP",
  "py": "Python",
  "go": "Go",
  "rs": "Rust",
  "java": "Java",
  "rb": "Ruby",
  "swift": "Swift",
  "kt": "Kotlin",
  "cs": "C#",
  "scala": "Scala",
  "cpp": "C++",
  "cc": "C++",
  "cxx": "C++",
  "c": "C"
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
function isNewOrWorsened(v, deltaMap) {
  const delta = deltaMap.get(createDeltaKey(v));
  return !!delta && (delta.severity === "new" || delta.delta > 0);
}
function groupViolationsByFile(violations) {
  const byFile = /* @__PURE__ */ new Map();
  for (const v of violations) {
    const existing = byFile.get(v.filepath) || [];
    existing.push(v);
    byFile.set(v.filepath, existing);
  }
  return byFile;
}
function formatFileGroup(violations, files, deltaMap) {
  return Array.from(groupViolationsByFile(violations).entries()).map(([filepath, vs]) => {
    const fileData = files[filepath];
    const violationList = vs.map((v) => formatViolationLine(v, deltaMap)).join("\n");
    const dependencyContext = fileData ? buildDependencyContext(fileData) : "";
    const fileContext = fileData ? buildFileContext(filepath, fileData) : "";
    return `**${filepath}** (risk: ${fileData?.riskLevel || "unknown"})${fileContext}
${violationList}${dependencyContext}`;
  }).join("\n\n");
}
function buildViolationsSummary(files, deltaMap) {
  if (deltaMap.size === 0) {
    const allViolations2 = Object.values(files).flatMap((data) => data.violations);
    return formatFileGroup(allViolations2, files, deltaMap);
  }
  const allViolations = Object.values(files).filter((data) => data.violations.length > 0).flatMap((data) => data.violations);
  const newViolations = allViolations.filter((v) => isNewOrWorsened(v, deltaMap));
  const preExisting = allViolations.filter((v) => !isNewOrWorsened(v, deltaMap));
  const sections = [];
  if (newViolations.length > 0) {
    sections.push(`### New/Worsened Violations (introduced or worsened in this PR)

${formatFileGroup(newViolations, files, deltaMap)}`);
  }
  if (preExisting.length > 0) {
    sections.push(`### Pre-existing Violations (in files touched by this PR)

${formatFileGroup(preExisting, files, deltaMap)}`);
  }
  return sections.join("\n\n");
}
function formatDeltaChange(d) {
  const from = d.baseComplexity ?? "new";
  const to = d.headComplexity ?? "removed";
  return `  - ${d.symbolName}: ${from} \u2192 ${to} (${formatDelta(d.delta)})`;
}
function buildDeltaContext(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const improved = deltas.filter((d) => d.severity === "improved");
  const degraded = deltas.filter((d) => (d.severity === "error" || d.severity === "warning") && d.delta > 0);
  const newFuncs = deltas.filter((d) => d.severity === "new");
  const deleted = deltas.filter((d) => d.severity === "deleted");
  const sections = [
    `
## Complexity Changes (vs base branch)`,
    `- **Degraded**: ${degraded.length} function(s) got more complex`,
    `- **Improved**: ${improved.length} function(s) got simpler`,
    `- **New**: ${newFuncs.length} new complex function(s)`,
    `- **Removed**: ${deleted.length} complex function(s) deleted`
  ];
  if (degraded.length > 0) {
    sections.push(`
Functions that got worse:
${degraded.map(formatDeltaChange).join("\n")}`);
  }
  if (improved.length > 0) {
    sections.push(`
Functions that improved:
${improved.map(formatDeltaChange).join("\n")}`);
  }
  if (newFuncs.length > 0) {
    sections.push(`
New complex functions:
${newFuncs.map((d) => `  - ${d.symbolName}: complexity ${d.headComplexity}`).join("\n")}`);
  }
  return sections.join("\n");
}
function buildSnippetsSection(codeSnippets) {
  return Array.from(codeSnippets.entries()).map(([key, code]) => {
    const [filepath, symbolName] = key.split("::");
    return `### ${filepath} - ${symbolName}
\`\`\`
${code}
\`\`\``;
  }).join("\n\n");
}
function buildReviewPrompt(report, prContext, codeSnippets, deltas = null) {
  const { summary, files } = report;
  const deltaMap = buildDeltaMap(deltas);
  const violationsByFile = Object.entries(files).filter(([_, data]) => data.violations.length > 0);
  const violationsSummary = buildViolationsSummary(files, deltaMap);
  const snippetsSection = buildSnippetsSection(codeSnippets);
  const deltaContext = buildDeltaContext(deltas);
  return `# Code Complexity Review Request

## Context
- **Repository**: ${prContext.owner}/${prContext.repo}
- **PR**: #${prContext.pullNumber} - ${prContext.title}
- **Files with violations**: ${violationsByFile.length}
- **Total violations**: ${summary.totalViolations} (${summary.bySeverity.error} errors, ${summary.bySeverity.warning} warnings)
${deltaContext}
## Complexity Violations Found

${violationsSummary}

## Code Snippets

${snippetsSection || "_No code snippets available_"}

## Your Task

**IMPORTANT**: Before suggesting refactorings, analyze the code snippets below to identify the codebase's patterns:
- Are utilities implemented as functions or classes?
- How are similar refactorings done elsewhere in the codebase?
- What naming conventions are used?
- How is code organized (modules, files, exports)?

For each violation:
1. **Explain** why this complexity is problematic in this specific context
   - Consider the file type (controller, service, component, etc.) and language
   - Note if this is the only violation in the file or one of many
   - Consider dependency impact - high-risk files need extra scrutiny
2. **Suggest** concrete refactoring steps (not generic advice like "break into smaller functions")
   - Be specific to the language and framework patterns
   - Consider file type conventions (e.g., controllers often delegate to services)
   - **Match the existing codebase patterns** - if utilities are functions, suggest functions; if they're classes, suggest classes
3. **Prioritize** which violations are most important to address - focus on functions that got WORSE (higher delta)
4. If the complexity seems justified for the use case, say so
   - Some patterns (orchestration, state machines) may legitimately be complex
5. Celebrate improvements! If a function got simpler, acknowledge it.

Format your response as a PR review comment with:
- A brief summary at the top (2-3 sentences)
- File-by-file breakdown with specific suggestions
- Prioritized list of recommended changes

Be concise but actionable. Focus on the highest-impact improvements.`;
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
function groupDeltasByMetric(deltas) {
  return (0, import_collect2.default)(deltas).groupBy("metricType").map((group) => group.sum("delta")).all();
}
function buildMetricBreakdownForDisplay(deltaByMetric) {
  const metricOrder = ["cyclomatic", "cognitive", "halstead_effort", "halstead_bugs"];
  const emojiMap = {
    cyclomatic: "\u{1F500}",
    cognitive: "\u{1F9E0}",
    halstead_effort: "\u23F1\uFE0F",
    halstead_bugs: "\u{1F41B}"
  };
  return (0, import_collect2.default)(metricOrder).map((metricType) => {
    const metricDelta = deltaByMetric[metricType] || 0;
    const emoji = emojiMap[metricType] || "\u{1F4CA}";
    const sign = metricDelta >= 0 ? "+" : "";
    return `${emoji} ${sign}${formatDeltaValue(metricType, metricDelta)}`;
  }).all().join(" | ");
}
function categorizeDeltas(deltas) {
  return deltas.reduce((acc, d) => {
    if (["improved", "deleted"].includes(d.severity)) acc.improved++;
    else if (["warning", "error", "new"].includes(d.severity)) acc.degraded++;
    return acc;
  }, { improved: 0, degraded: 0 });
}
function getTrendEmoji(totalDelta) {
  if (totalDelta > 0) return "\u2B06\uFE0F";
  if (totalDelta < 0) return "\u2B07\uFE0F";
  return "\u27A1\uFE0F";
}
function formatDeltaDisplay(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const { improved, degraded } = categorizeDeltas(deltas);
  const deltaByMetric = groupDeltasByMetric(deltas);
  const totalDelta = Object.values(deltaByMetric).reduce((sum, v) => sum + v, 0);
  if (totalDelta === 0 && improved === 0) {
    return "\n\n**Complexity:** No change from this PR.";
  }
  const metricBreakdown = buildMetricBreakdownForDisplay(deltaByMetric);
  const trend = getTrendEmoji(totalDelta);
  let display = `

**Complexity Change:** ${metricBreakdown} ${trend}`;
  if (improved > 0) display += ` | ${improved} improved`;
  if (degraded > 0) display += ` | ${degraded} degraded`;
  return display;
}
function formatTokenStats(tokenUsage) {
  if (!tokenUsage || tokenUsage.totalTokens <= 0) return "";
  return `
- Tokens: ${tokenUsage.totalTokens.toLocaleString()} ($${tokenUsage.cost.toFixed(4)})`;
}
function formatFallbackNote(isFallback) {
  if (!isFallback) return "";
  return `

> \u{1F4A1} *These violations exist in files touched by this PR but not on changed lines. Consider the [boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html): leave the code cleaner than you found it!*
`;
}
function countViolationsByNovelty(totalViolations, deltas) {
  if (!deltas || deltas.length === 0) {
    return { newCount: 0, preExistingCount: 0, improvedCount: 0 };
  }
  const newCount = deltas.filter(
    (d) => d.severity === "new" || d.severity === "warning" || d.severity === "error"
  ).filter((d) => d.severity === "new" || d.delta > 0).length;
  const improvedCount = deltas.filter((d) => d.severity === "improved").length;
  const preExistingCount = Math.max(0, totalViolations - newCount);
  return { newCount, preExistingCount, improvedCount };
}
function buildHeaderLine(totalViolations, deltas) {
  const { newCount, preExistingCount, improvedCount } = countViolationsByNovelty(totalViolations, deltas);
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
    parts.push(`${preExistingCount} pre-existing issue${preExistingCount === 1 ? "" : "s"} in touched files.`);
  }
  return parts.join(" ");
}
function formatReviewComment(aiReview, report, isFallback = false, tokenUsage, deltas, uncoveredNote = "") {
  const { summary } = report;
  const deltaDisplay = formatDeltaDisplay(deltas);
  const fallbackNote = formatFallbackNote(isFallback);
  const tokenStats = formatTokenStats(tokenUsage);
  const headerLine = buildHeaderLine(summary.totalViolations, deltas);
  return `<!-- lien-ai-review -->
## \u{1F441}\uFE0F Veille

${headerLine}${deltaDisplay}${fallbackNote}

---

${aiReview}

---${uncoveredNote}

<details>
<summary>\u{1F4CA} Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${tokenStats}

</details>

*[Veille](https://lien.dev) by Lien*`;
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
    return { emoji: "\u2705", message: `**Improved!** This PR reduces complexity by ${Math.abs(delta)}.` };
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
    return { emoji: "\u27A1\uFE0F", message: "**Stable** - Complexity increased slightly but within limits." };
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
  const filesWithDependents = Object.values(report.files).filter((f) => f.dependentCount && f.dependentCount > 0);
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
function buildBatchedCommentsPrompt(violations, codeSnippets, report) {
  const violationsText = violations.map((v, i) => {
    const key = `${v.filepath}::${v.symbolName}`;
    const snippet = codeSnippets.get(key);
    const snippetSection = snippet ? `
Code:
\`\`\`
${snippet}
\`\`\`` : "";
    const metricType = v.metricType || "cyclomatic";
    const metricLabel = getMetricLabel(metricType);
    const valueDisplay = formatComplexityValue(metricType, v.complexity);
    const thresholdDisplay = formatThresholdValue(metricType, v.threshold);
    const halsteadContext = formatHalsteadContext(v);
    const fileData = report.files[v.filepath];
    const dependencyContext = fileData ? buildDependencyContext(fileData) : "";
    const fileContext = fileData ? buildFileContext(v.filepath, fileData) : "";
    return `### ${i + 1}. ${v.filepath}::${v.symbolName}
- **Function**: \`${v.symbolName}\` (${v.symbolType})
- **Complexity**: ${valueDisplay} ${metricLabel} (threshold: ${thresholdDisplay})${halsteadContext}
- **Severity**: ${v.severity}${fileContext}${dependencyContext}${snippetSection}`;
  }).join("\n\n");
  const jsonKeys = violations.map((v) => `  "${v.filepath}::${v.symbolName}": "your comment here"`).join(",\n");
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

Be direct and specific to THIS code. Avoid generic advice like "break into smaller functions."

**Example of a good comment:**
"${getExampleForPrimaryMetric(violations)}"

Write comments of similar quality and specificity for each violation below.

IMPORTANT: Do NOT include headers like "Complexity: X" or emojis - we add those.

## Response Format

Respond with ONLY valid JSON. Each key is "filepath::symbolName", value is the comment text.
Use \\n for newlines within comments.

\`\`\`json
{
${jsonKeys}
}
\`\`\``;
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
async function generateReview(prompt, apiKey, model, logger) {
  logger.info(`Calling OpenRouter with model: ${model}`);
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
          content: "You are an expert code reviewer. Provide actionable, specific feedback on code complexity issues. Be concise but thorough. Before suggesting refactorings, analyze the code snippets provided to identify the codebase's architectural patterns (e.g., functions vs classes, module organization, naming conventions). Then suggest refactorings that match those existing patterns."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 2e3,
      temperature: 0.3,
      // Lower temperature for more consistent reviews
      // Enable usage accounting to get cost data
      // https://openrouter.ai/docs/guides/guides/usage-accounting
      usage: {
        include: true
      }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter API error (${response.status}): ${errorText}`
    );
  }
  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No response from OpenRouter");
  }
  const review = data.choices[0].message.content;
  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : "";
    logger.info(
      `Tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`
    );
  }
  return review;
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
async function generateLineComments(violations, codeSnippets, apiKey, model, report, logger) {
  if (violations.length === 0) {
    return /* @__PURE__ */ new Map();
  }
  logger.info(`Generating comments for ${violations.length} violations in single batch`);
  const prompt = buildBatchedCommentsPrompt(violations, codeSnippets, report);
  const data = await callBatchedCommentsAPI(prompt, apiKey, model);
  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : "";
    logger.info(`Batch tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`);
  }
  const commentsMap = parseCommentsResponse(data.choices[0].message.content, logger);
  return mapCommentsToViolations(commentsMap, violations, logger);
}
function filterAnalyzableFiles(files) {
  const codeExtensions = /* @__PURE__ */ new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".php"
  ]);
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
    logger.info("Indexing codebase...");
    const indexResult = await indexCodebase({
      rootDir
    });
    logger.info(`Indexing complete: ${indexResult.chunksCreated} chunks from ${indexResult.filesIndexed} files (success: ${indexResult.success})`);
    if (!indexResult.success || indexResult.chunksCreated === 0) {
      logger.warning(`Indexing produced no chunks for ${rootDir}`);
      return null;
    }
    const vectorDB = await createVectorDB(rootDir);
    await vectorDB.initialize();
    logger.info("Analyzing complexity...");
    const analyzer = new ComplexityAnalyzer(vectorDB);
    const report = await analyzer.analyze(files);
    logger.info(`Found ${report.summary.totalViolations} violations`);
    return report;
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
  try {
    logger.info(`Checking out base branch at ${baseSha.substring(0, 7)}...`);
    const currentHead = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    execSync(`git checkout --force ${baseSha}`, { stdio: "pipe" });
    logger.info("Base branch checked out");
    logger.info("Analyzing base branch complexity...");
    const baseReport = await runComplexityAnalysis(filesToAnalyze, threshold, rootDir, logger);
    execSync(`git checkout --force ${currentHead}`, { stdio: "pipe" });
    logger.info("Restored to HEAD");
    if (baseReport) {
      logger.info(`Base branch: ${baseReport.summary.totalViolations} violations`);
    }
    return baseReport;
  } catch (error2) {
    logger.warning(`Failed to analyze base branch: ${error2}`);
    try {
      const currentHead = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      execSync(`git checkout --force ${currentHead}`, { stdio: "pipe" });
    } catch (restoreError) {
      logger.warning(`Failed to restore HEAD: ${restoreError}`);
    }
    return null;
  }
}
async function getBaselineReport(config, prContext, filesToAnalyze, rootDir, logger) {
  if (config.enableDeltaTracking) {
    logger.info("Delta tracking enabled - analyzing base branch...");
    return await analyzeBaseBranch(prContext.baseSha, filesToAnalyze, config.threshold, rootDir, logger);
  }
  if (config.baselineComplexityPath) {
    logger.warning("baseline_complexity input is deprecated. Use enable_delta_tracking: true instead.");
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
  const baselineReport = await getBaselineReport(config, prContext, filesToAnalyze, rootDir, logger);
  const currentReport = await runComplexityAnalysis(filesToAnalyze, config.threshold, rootDir, logger);
  if (!currentReport) {
    logger.warning("Failed to get complexity report");
    return null;
  }
  logger.info(`Analysis complete: ${currentReport.summary.totalViolations} violations found`);
  const deltas = baselineReport ? calculateDeltas(baselineReport, currentReport, filesToAnalyze) : null;
  return {
    currentReport,
    baselineReport,
    deltas,
    filesToAnalyze
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
function createDeltaKey2(v) {
  return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}
function buildDeltaMap2(deltas) {
  if (!deltas) return /* @__PURE__ */ new Map();
  return new Map(
    (0, import_collect.default)(deltas).map((d) => [createDeltaKey2(d), d]).all()
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
  const delta = deltaMap.get(createDeltaKey2(v));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
  const emoji = getMetricEmoji2(v.metricType);
  const metricLabel = getMetricLabel(v.metricType || "cyclomatic");
  const valueDisplay = formatComplexityValue(v.metricType || "cyclomatic", v.complexity);
  return `* \`${v.symbolName}\` in \`${v.filepath}\`: ${emoji} ${metricLabel} ${valueDisplay}${deltaStr}`;
}
var BOY_SCOUT_LINK = "[boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)";
function categorizeUncoveredViolations(violations, deltaMap) {
  const newOrWorsened = violations.filter((v) => {
    const delta = deltaMap.get(createDeltaKey2(v));
    return delta && (delta.severity === "new" || delta.delta > 0);
  });
  const preExisting = violations.filter((v) => {
    const delta = deltaMap.get(createDeltaKey2(v));
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
  const { newOrWorsened, preExisting } = categorizeUncoveredViolations(uncoveredViolations, deltaMap);
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
function groupDeltasByMetric2(deltas) {
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
function formatDeltaDisplay2(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const deltaSummary = calculateDeltaSummary(deltas);
  const deltaByMetric = groupDeltasByMetric2(deltas);
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
  const deltaDisplay = formatDeltaDisplay2(deltas);
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
function buildLineComments(violationsWithLines, aiComments, deltaMap, logger) {
  return (0, import_collect.default)(violationsWithLines).filter(({ violation }) => aiComments.has(violation)).map(({ violation, commentLine }) => {
    const comment = aiComments.get(violation);
    const delta = deltaMap.get(createDeltaKey2(violation));
    const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
    const severityEmoji = delta ? formatSeverityEmoji(delta.severity) : violation.severity === "error" ? "\u{1F534}" : "\u{1F7E1}";
    const lineNote = commentLine !== violation.startLine ? ` *(\`${violation.symbolName}\` starts at line ${violation.startLine})*` : "";
    const metricLabel = getMetricLabel(violation.metricType || "cyclomatic");
    const valueDisplay = formatComplexityValue(violation.metricType || "cyclomatic", violation.complexity);
    const thresholdDisplay = formatThresholdValue(violation.metricType || "cyclomatic", violation.threshold);
    logger.info(`Adding comment for ${violation.filepath}:${commentLine} (${violation.symbolName})${deltaStr}`);
    return {
      path: violation.filepath,
      line: commentLine,
      body: `${severityEmoji} **${metricLabel.charAt(0).toUpperCase() + metricLabel.slice(1)}: ${valueDisplay}**${deltaStr} (threshold: ${thresholdDisplay})${lineNote}

${comment}`
    };
  }).all();
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
    const key = createDeltaKey2(violation);
    const delta = deltaMap.get(key);
    return !delta || delta.severity === "new" || delta.delta > 0;
  });
}
function getSkippedViolations(violationsWithLines, deltaMap) {
  return violationsWithLines.filter(({ violation }) => {
    const key = createDeltaKey2(violation);
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
async function generateAndPostReview(octokit, prContext, processed, deltaMap, codeSnippets, config, report, deltas, logger) {
  const commentableViolations = processed.newOrDegraded.map((v) => v.violation);
  logger.info(`Generating AI comments for ${commentableViolations.length} new/degraded violations...`);
  const aiComments = await generateLineComments(
    commentableViolations,
    codeSnippets,
    config.openrouterApiKey,
    config.model,
    report,
    logger
  );
  const lineComments = buildLineComments(processed.newOrDegraded, aiComments, deltaMap, logger);
  logger.info(`Built ${lineComments.length} line comments for new/degraded violations`);
  const uncoveredNote = buildUncoveredNote(processed.uncovered, deltaMap);
  const skippedNote = buildSkippedNote(processed.skipped);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);
  await postPRReview(octokit, prContext, lineComments, summaryBody, logger);
  logger.info(`Posted review with ${lineComments.length} line comments`);
}
async function postLineReview(octokit, prContext, report, violations, codeSnippets, config, logger, deltas = null) {
  const diffLines = await getPRDiffLines(octokit, prContext);
  logger.info(`Diff covers ${diffLines.size} files`);
  const deltaMap = buildDeltaMap2(deltas);
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
  await generateAndPostReview(
    octokit,
    prContext,
    processed,
    deltaMap,
    codeSnippets,
    config,
    report,
    deltas,
    logger
  );
}
async function postSummaryReview(octokit, prContext, report, codeSnippets, config, logger, isFallback = false, deltas = null, uncoveredNote = "") {
  const prompt = buildReviewPrompt(report, prContext, codeSnippets, deltas);
  logger.debug(`Prompt length: ${prompt.length} characters`);
  const aiReview = await generateReview(
    prompt,
    config.openrouterApiKey,
    config.model,
    logger
  );
  const usage = getTokenUsage();
  const comment = formatReviewComment(aiReview, report, isFallback, usage, deltas, uncoveredNote);
  await postPRComment(octokit, prContext, comment, logger);
  logger.info("Successfully posted AI review summary comment");
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
  if (config.reviewStyle === "summary") {
    const diffLines = await getPRDiffLines(octokit, prContext);
    const deltaMap = buildDeltaMap2(result.deltas);
    const { uncovered } = partitionViolationsByDiff(violations, diffLines);
    const uncoveredNote = buildUncoveredNote(uncovered, deltaMap);
    await postSummaryReview(
      octokit,
      prContext,
      result.currentReport,
      codeSnippets,
      config,
      logger,
      false,
      result.deltas,
      uncoveredNote
    );
  } else {
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
  const reviewStyle = core.getInput("review_style") || "line";
  return {
    openrouterApiKey: core.getInput("openrouter_api_key", { required: true }),
    model: core.getInput("model") || "anthropic/claude-sonnet-4",
    threshold: core.getInput("threshold") || "15",
    reviewStyle: reviewStyle === "summary" ? "summary" : "line",
    enableDeltaTracking: core.getInput("enable_delta_tracking") === "true",
    baselineComplexityPath: core.getInput("baseline_complexity") || ""
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
    core.info(`Review style: ${config.reviewStyle}`);
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