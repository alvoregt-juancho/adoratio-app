(function (global) {
    "use strict";

    var TIME_24_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
    var TIME_12_RE = /^(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)$/i;

    function timeToMinutes(hhmm) {
        if (!hhmm) return 0;
        var parts = String(hhmm).split(":");
        return Number(parts[0]) * 60 + (Number(parts[1]) || 0);
    }

    function minutesToTime24(total) {
        var mins = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    }

    function addMinutesToTime(hhmm, minutes) {
        return minutesToTime24(timeToMinutes(hhmm) + minutes);
    }

    function format12(hhmm) {
        if (!hhmm) return "";
        var mins = timeToMinutes(hhmm);
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        var suffix = h < 12 ? "AM" : "PM";
        var hour12 = h % 12 || 12;
        return m ? hour12 + ":" + String(m).padStart(2, "0") + " " + suffix : hour12 + " " + suffix;
    }

    function formatRange(start, end, sep) {
        if (!start || !end) return "";
        return format12(start) + (sep || " – ") + format12(end);
    }

    function parseInput(input) {
        var raw = String(input || "").trim().replace(/\s+/g, " ");
        if (!raw) return null;

        var m12 = raw.match(TIME_12_RE);
        if (m12) {
            var hour = Number(m12[1]);
            var minute = m12[2] != null ? Number(m12[2]) : 0;
            var period = m12[3].replace(/\./g, "").toLowerCase();
            var isPm = period.indexOf("p") === 0;
            if (hour < 1 || hour > 12 || minute > 59) return null;
            if (hour === 12) hour = isPm ? 12 : 0;
            else if (isPm) hour += 12;
            return minutesToTime24(hour * 60 + minute);
        }

        var m24 = raw.match(TIME_24_RE);
        if (m24) {
            return String(Number(m24[1])).padStart(2, "0") + ":" + m24[2];
        }

        return null;
    }

    function formatForInput(hhmm) {
        return format12(hhmm);
    }

    global.AdoratioTime = {
        format12: format12,
        formatRange: formatRange,
        parseInput: parseInput,
        formatForInput: formatForInput,
        addMinutes: addMinutesToTime,
    };
})(typeof window !== "undefined" ? window : global);
