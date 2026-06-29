const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    formatTime12,
    formatTimeRange12,
    parseTimeInput,
    addMinutesToTime,
} = require('../src/utils/timeFormat');

describe('formatTime12', () => {
    it('formats morning and afternoon times', () => {
        assert.equal(formatTime12('07:00'), '7 AM');
        assert.equal(formatTime12('07:30'), '7:30 AM');
        assert.equal(formatTime12('12:00'), '12 PM');
        assert.equal(formatTime12('13:15'), '1:15 PM');
        assert.equal(formatTime12('00:00'), '12 AM');
    });
});

describe('parseTimeInput', () => {
    it('parses standard 12-hour input', () => {
        assert.equal(parseTimeInput('7:00 AM'), '07:00');
        assert.equal(parseTimeInput('7:30 p.m.'), '19:30');
        assert.equal(parseTimeInput('12 PM'), '12:00');
        assert.equal(parseTimeInput('12 AM'), '00:00');
    });

    it('still accepts 24-hour input', () => {
        assert.equal(parseTimeInput('07:00'), '07:00');
        assert.equal(parseTimeInput('19:45'), '19:45');
    });

    it('rejects invalid values', () => {
        assert.equal(parseTimeInput('25:00'), null);
        assert.equal(parseTimeInput('noon'), null);
    });
});

describe('formatTimeRange12', () => {
    it('formats slot ranges', () => {
        assert.equal(formatTimeRange12('07:00', '08:00'), '7 AM – 8 AM');
    });
});

describe('addMinutesToTime', () => {
    it('offsets slot starts', () => {
        assert.equal(addMinutesToTime('07:00', 30), '07:30');
    });
});
