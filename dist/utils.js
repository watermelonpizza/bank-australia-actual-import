"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toTitleCase = exports.extractDate = void 0;
const date_fns_1 = require("date-fns");
function extractDate(dateString) {
    // Example date string: "12:00am Sat 31 December, 2022"
    // returns a date object
    // parse using date-fns
    const date = (0, date_fns_1.parse)(dateString, 'h:mma EEE d MMMM, yyyy', new Date());
    // convert to AEST, assuming the date from the bank is in UTC, don't care about daylight savings
    date.setHours(date.getHours() + 10);
    return date;
}
exports.extractDate = extractDate;
function toTitleCase(str) {
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
}
exports.toTitleCase = toTitleCase;
//# sourceMappingURL=utils.js.map