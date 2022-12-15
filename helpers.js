
/**
 * Capitalizes the first letter in a string.
 * @param {String} s 
 * @returns Capitalized s
 */
module.exports.capitalizeFirstWordInString = s => s && s[0].toUpperCase() + s.slice(1);

/**
 * Sorts properties of an object by its values, in decreasing order.
 * @param {Objects} obj 
 * @returns an array of the sorted object properties
 */
module.exports.sortObjectPropertiesByValue = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);

/**
 * Checks if an object is empty.
 * @param {Object} obj 
 * @returns boolean whether the object is empty or not
 */
module.exports.isObjectEmpty = obj => Object.keys(obj).length === 0;

/**
 * Temporarily halts program execution.
 * @param {Number} ms number of miliseconds to wait
 * @returns promise
 */
module.exports.delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Checks if dateTime is the last day of the month
 * @param {Date} dateTime 
 * @returns boolean whether dateTime is the last day of the month or not.
 */
module.exports.isLastDayOfMonth = (dateTime) => new Date(dateTime.getTime() + 86400000).getDate() === 1;
