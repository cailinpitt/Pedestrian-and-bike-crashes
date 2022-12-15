const expect = require('chai').expect;
const sinon = require('sinon');
const helpers = require('../helpers');

let clock;
let sandbox;

beforeEach(() => {
  sandbox = sinon.createSandbox();
  clock = sandbox.useFakeTimers();
});

afterEach(function () {
  sandbox.restore();
});

describe('helpers', function() {
  describe('capitalizeFirstWordInString', function() {
    it('should capitalize the first word in a string', function() {
      const expected = "Hello World";
      var result = helpers.capitalizeFirstWordInString("hello World");
      expect(result).to.eql(expected);
    });

    it('should return the same string when the first word is already capitalized', function() {
      const expected = "Hello World";
      var result = helpers.capitalizeFirstWordInString(expected);
      expect(result).to.eql(expected);
    });
  });

  describe('sortObjectPropertiesByValue', function() {
    it('should sort the object properties and return them in an array', function() {
      const expected = [["a", 10], ["b", 5]];
      var result = helpers.sortObjectPropertiesByValue({
        b: 5,
        a: 10,
      });
      expect(result).to.eql(expected);
    });

    it('handles objects that are already sorted', function() {
      const expected = [["a", 10], ["b", 5]];
      var result = helpers.sortObjectPropertiesByValue({
        a: 10,
        b: 5,
      });
      expect(result).to.eql(expected);
    });

    it('preserves the ordering of properties with equivalent values', function() {
      const expected = [["a", 10], ["c", 10], ["b", 5]];
      var result = helpers.sortObjectPropertiesByValue({
        a: 10,
        b: 5,
        c: 10,
      });
      expect(result).to.eql(expected);
    });
  });

  describe('sortObjectPropertiesByValue', function() {
    it('should sort the object properties and return them in an array', function() {
      const expected = [["a", 10], ["b", 5]];
      var result = helpers.sortObjectPropertiesByValue({
        b: 5,
        a: 10,
      });
      expect(result).to.eql(expected);
    });

    it('handles objects that are already sorted', function() {
      const expected = [["a", 10], ["b", 5]];
      var result = helpers.sortObjectPropertiesByValue({
        a: 10,
        b: 5,
      });
      expect(result).to.eql(expected);
    });

    it('preserves the ordering of properties with equivalent values', function() {
      const expected = [["a", 10], ["c", 10], ["b", 5]];
      var result = helpers.sortObjectPropertiesByValue({
        a: 10,
        b: 5,
        c: 10,
      });
      expect(result).to.eql(expected);
    });
  });

  describe('isObjectEmpty', function() {
    it('returns true for an empty object', function() {
      var result = helpers.isObjectEmpty({});
      expect(result).to.be.true;
    });

    it('returns false for a non-empty object', function() {
      var result = helpers.isObjectEmpty({
        b: 5,
        a: 10,
      });
      expect(result).to.be.false;
    });
  });

  describe('delay', function() {
    it('delays program execution', async function() {
      const promise = helpers.delay(1000);
      let fulfilled = false;

      promise.then(() => {
        fulfilled = true;
        done();
      });
    
      clock.tick(999);
      await Promise.resolve();  
      expect(fulfilled).to.be.false;

      clock.tick(2);
      await Promise.resolve();
      expect(fulfilled).to.be.true;
    });
  });

  describe('isLastDayOfMonth', function() {
    it('returns true for a Date that is the last day of the month', function() {
      var result = helpers.isLastDayOfMonth(new Date("December 31, 2022 03:24:00"));
      expect(result).to.be.true;
    });

    it('returns false for Date that is not the last day of the month', function() {
      var result = helpers.isLastDayOfMonth(new Date("December 17, 1995 03:24:00"));
      expect(result).to.be.false;
    });
  });
});
