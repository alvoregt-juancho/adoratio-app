(function () {
    "use strict";

    const toast = window.AdoratioToast || function (m) { alert(m); };

    const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
    const DAY_SHORT = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

    const PHONE_DIGITS = 8;

    function normalizePhone(raw) {
        return (raw || "").replace(/\D/g, "");
    }

    function isValidPhone(phone) {
        return new RegExp("^\\d{" + PHONE_DIGITS + "}$").test(phone);
    }

    function bindPhoneInput(input) {
        if (!input || input.dataset.phoneBound) return;
        input.dataset.phoneBound = "1";
        input.addEventListener("input", function () {
            const digits = normalizePhone(input.value).slice(0, PHONE_DIGITS);
            if (input.value !== digits) input.value = digits;
        });
        input.addEventListener("paste", function (e) {
            e.preventDefault();
            const pasted = normalizePhone((e.clipboardData || window.clipboardData).getData("text"));
            input.value = pasted.slice(0, PHONE_DIGITS);
        });
    }

    function initPhoneInputs() {
        bindPhoneInput(document.getElementById("resPhone"));
        bindPhoneInput(document.getElementById("myPhone"));
    }

    const dayPicker = document.getElementById("dayPicker");
    const slotsList = document.getElementById("slotsList");
    const daysCarousel = document.getElementById("daysCarousel");
    const reserveModal = document.getElementById("reserveModal");
    const myModal = document.getElementById("myModal");
    const daySelectModal = document.getElementById("daySelectModal");
    const biweeklySelectModal = document.getElementById("biweeklySelectModal");

    let selectedSlot = null;
    let dailyModeActive = false;
    let selectedWeekDays = [];
    let selectedBiweeklyWeeks = null;

    const BIWEEKLY_LABELS = {
        "1,3": "Semana 1 y 3",
        "2,4": "Semana 2 y 4",
    };
    let appSettings = {
        frequencies: ['WEEKLY', 'BIWEEKLY', 'DAILY'],
        allowOffsetStartTimes: false,
        allowThirtyMinuteDurations: false,
    };

    const THEME_KEY = "adoratio_horarios_theme";

    const THEME_ICONS = {
        sun: '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.75" fill="none"/><path d="M12 2v2.5M12 19.5V22M4.22 4.22l1.77 1.77M18.01 18.01l1.77 1.77M2 12h2.5M19.5 12H22M4.22 19.78l1.77-1.77M18.01 5.99l1.77-1.77" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
        moon: '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A7.5 7.5 0 0 1 9.5 4 6 6 0 1 0 20 14.5Z" stroke="currentColor" stroke-width="1.75" fill="none" stroke-linejoin="round"/></svg>',
    };

    function applyTheme(theme) {
        document.body.dataset.theme = theme;
        localStorage.setItem(THEME_KEY, theme);
        const btn = document.getElementById("themeToggle");
        if (btn) {
            btn.innerHTML = theme === "dark" ? THEME_ICONS.sun : THEME_ICONS.moon;
            btn.setAttribute("aria-label", theme === "dark"
                ? "Activar modo claro"
                : "Activar modo oscuro");
        }
    }

    function toggleTheme() {
        applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
    }

    function initTheme() {
        applyTheme(localStorage.getItem(THEME_KEY) || document.body.dataset.theme || "light");
    }

    function todayWeekday() {
        const d = new Date().getDay();
        return d === 0 ? 7 : d;
    }

    function dateStrFromDate(d) {
        return d.getFullYear() + "-" +
            String(d.getMonth() + 1).padStart(2, "0") + "-" +
            String(d.getDate()).padStart(2, "0");
    }

    function dateForWeekday(weekday) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const current = todayWeekday();
        let diff = Number(weekday) - current;
        if (diff < 0) diff += 7;
        const target = new Date(today);
        target.setDate(today.getDate() + diff);
        return dateStrFromDate(target);
    }

    function selectedDayLabel() {
        return DAY_NAMES[Number(dayPicker.value)] || "";
    }

    function selectedDate() {
        return dateForWeekday(dayPicker.value);
    }

    function formatDateShort(dateStr) {
        const parts = dateStr.split("-");
        if (parts.length !== 3) return dateStr;
        return parts[2] + "/" + parts[1] + "/" + parts[0];
    }

    function openModal(modal) {
        modal.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    function closeModal(modal) {
        modal.classList.remove("active");
        document.body.style.overflow = "";
    }

    function closeAllModals() {
        document.querySelectorAll(".modal-overlay").forEach(closeModal);
    }

    function closeTopModal() {
        if (daySelectModal && daySelectModal.classList.contains("active")) {
            closeModal(daySelectModal);
            return;
        }
        if (biweeklySelectModal && biweeklySelectModal.classList.contains("active")) {
            closeBiweeklyModal(true);
            return;
        }
        closeAllModals();
    }

    function formatWeekDaysSummary(days) {
        if (!days.length) return "";
        if (days.length === 7) return "Todos los días de la semana";
        return days.map(function (d) { return DAY_SHORT[d]; }).join(", ");
    }

    function updateDailySummary() {
        const summary = document.getElementById("dailyDaysSummary");
        const dailyBtn = document.getElementById("btn-open-daily-days");
        if (!summary || !dailyBtn) return;

        if (dailyModeActive && selectedWeekDays.length) {
            summary.textContent = "Días seleccionados: " + formatWeekDaysSummary(selectedWeekDays);
            summary.hidden = false;
            dailyBtn.classList.add("is-active");
            dailyBtn.textContent = "Diario — editar días";
        } else {
            summary.hidden = true;
            summary.textContent = "";
            dailyBtn.classList.remove("is-active");
            dailyBtn.textContent = "Diario — seleccionar días";
        }
    }

    function clearBiweeklySelection() {
        selectedBiweeklyWeeks = null;
        document.querySelectorAll('input[name="biweeklyWeeks"]').forEach(function (radio) {
            radio.checked = false;
        });
        updateBiweeklySummary();
    }

    function updateBiweeklySummary() {
        const summary = document.getElementById("biweeklyWeeksSummary");
        if (!summary) return;

        if (selectedBiweeklyWeeks) {
            summary.textContent = "Quincena: " + (BIWEEKLY_LABELS[selectedBiweeklyWeeks] || selectedBiweeklyWeeks);
            summary.hidden = false;
        } else {
            summary.hidden = true;
            summary.textContent = "";
        }
    }

    function clearDailyMode() {
        dailyModeActive = false;
        selectedWeekDays = [];
        updateDailySummary();
    }

    function resetBookingFrequency() {
        clearDailyMode();
        clearBiweeklySelection();
        const advancedFreqContainer = document.getElementById("advanced-freq-container");
        const btnToggleFreq = document.getElementById("btn-toggle-advanced-freq");
        if (advancedFreqContainer) advancedFreqContainer.classList.remove("visible");
        if (btnToggleFreq) btnToggleFreq.textContent = "+ Más opciones de frecuencia";
        resetPrimaryFrequency();
    }

    function buildWeekdayGrid() {
        const grid = document.getElementById("weekdayGrid");
        if (!grid || grid.childElementCount) return;

        for (let wd = 1; wd <= 7; wd++) {
            const wrap = document.createElement("div");
            wrap.className = "weekday-toggle";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.id = "weekday-" + wd;
            input.value = String(wd);
            const label = document.createElement("label");
            label.setAttribute("for", "weekday-" + wd);
            label.textContent = DAY_NAMES[wd];
            wrap.appendChild(input);
            wrap.appendChild(label);
            grid.appendChild(wrap);
        }
    }

    function syncWeekdayGridFromSelection() {
        document.querySelectorAll("#weekdayGrid input[type='checkbox']").forEach(function (input) {
            input.checked = selectedWeekDays.includes(Number(input.value));
        });
    }

    function readWeekdayGridSelection() {
        const days = [];
        document.querySelectorAll("#weekdayGrid input[type='checkbox']:checked").forEach(function (input) {
            days.push(Number(input.value));
        });
        return days.sort(function (a, b) { return a - b; });
    }

    function openDaySelectModal() {
        if (!daySelectModal) return;
        buildWeekdayGrid();
        const slotLabel = document.getElementById("daySelectSlotLabel");
        if (slotLabel && selectedSlot) {
            slotLabel.textContent = selectedSlot.startTime + " – " + selectedSlot.endTime;
        } else if (slotLabel) {
            slotLabel.textContent = "";
        }
        if (!selectedWeekDays.length) {
            selectedWeekDays = [Number(dayPicker.value)];
        }
        syncWeekdayGridFromSelection();
        openModal(daySelectModal);
    }

    function openBiweeklySelectModal() {
        if (!biweeklySelectModal) return;
        document.querySelectorAll('input[name="biweeklyWeeks"]').forEach(function (radio) {
            radio.checked = radio.value === selectedBiweeklyWeeks;
        });
        openModal(biweeklySelectModal);
    }

    function closeBiweeklyModal(revertIfEmpty) {
        if (revertIfEmpty && !selectedBiweeklyWeeks) {
            const weekly = document.getElementById("freq-weekly");
            if (weekly && !weekly.disabled) weekly.checked = true;
        }
        closeModal(biweeklySelectModal);
    }

    function confirmBiweeklySelection() {
        const selected = document.querySelector('input[name="biweeklyWeeks"]:checked');
        if (!selected) {
            toast("Selecciona las semanas de tu quincena.", "error");
            return;
        }
        selectedBiweeklyWeeks = selected.value;
        clearDailyMode();
        document.getElementById("freq-biweekly").checked = true;
        updateBiweeklySummary();
        closeModal(biweeklySelectModal);
    }

    function confirmDaySelection() {
        const days = readWeekdayGridSelection();
        if (!days.length) {
            toast("Selecciona al menos un día.", "error");
            return;
        }
        selectedWeekDays = days;
        dailyModeActive = true;
        clearBiweeklySelection();
        document.querySelectorAll('input[name="commitmentFreq"]').forEach(function (radio) {
            radio.checked = false;
        });
        updateDailySummary();
        closeModal(daySelectModal);
    }

    function initDayCarousel() {
        daysCarousel.innerHTML = "";
        for (let wd = 1; wd <= 7; wd++) {
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = "day-pill" + (Number(dayPicker.value) === wd ? " active" : "");
            pill.dataset.weekday = String(wd);
            pill.setAttribute("role", "tab");
            pill.setAttribute("aria-selected", Number(dayPicker.value) === wd ? "true" : "false");
            pill.textContent = DAY_NAMES[wd];
            pill.addEventListener("click", function () {
                dayPicker.value = String(wd);
                document.querySelectorAll(".day-pill").forEach(function (p) {
                    const on = p.dataset.weekday === String(wd);
                    p.classList.toggle("active", on);
                    p.setAttribute("aria-selected", on ? "true" : "false");
                });
                loadSlots();
                pill.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" });
            });
            daysCarousel.appendChild(pill);
        }
        const active = daysCarousel.querySelector(".day-pill.active");
        if (active) {
            requestAnimationFrame(function () {
                active.scrollIntoView({ inline: "center", block: "nearest" });
            });
        }
    }

    const ICON_ADD = '<svg class="icon-add" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>';

    function cardStatus(slot, full) {
        const reserved = slot.reserved != null ? slot.reserved : (slot.capacity - slot.available);
        if (full) {
            return {
                text: reserved + " adorador" + (reserved !== 1 ? "es" : "") + " · Lleno",
                showIcon: false,
                variant: "full",
            };
        }
        if (slot.gapAlert) {
            return { text: "Requiere custodia", showIcon: true, variant: "needs-custody" };
        }
        if (slot.critical || reserved === 0) {
            return { text: "Disponible para custodia", showIcon: true, variant: "empty-slot" };
        }
        return {
            text: reserved + " adorador" + (reserved !== 1 ? "es" : "") + " · Unirse",
            showIcon: true,
            variant: "available",
        };
    }

    function buildCardHtml(slot, status) {
        const time = slot.startTime + "–" + slot.endTime;
        let html = '<span class="time-signature">' + time + "</span>";
        html += '<div class="status-indicator">';
        if (status.showIcon) html += ICON_ADD;
        html += '<span class="status-text">' + status.text + "</span></div>";
        return html;
    }

    async function loadSlots() {
        const date = selectedDate();
        slotsList.innerHTML = '<p class="muted">Cargando turnos…</p>';
        const noteEl = document.getElementById("scheduleNote");
        if (noteEl) noteEl.hidden = true;
        try {
            const res = await fetch("/api/slots?date=" + encodeURIComponent(date));
            const data = await res.json();
            if (noteEl && data.note) {
                noteEl.textContent = data.note;
                noteEl.hidden = false;
            }
            if (data.settings) {
                appSettings = data.settings;
                applyBookingSettings();
            }
            renderSlots(data.slots || [], data.message);
        } catch (e) {
            slotsList.innerHTML = '<p class="muted">No se pudieron cargar los turnos.</p>';
        }
    }

    function renderSlots(slots, message) {
        if (!slots.length) {
            slotsList.innerHTML =
                '<div class="schedule-notice">' +
                (message || "No hay turnos disponibles.") +
                "</div>";
            return;
        }
        slotsList.innerHTML = "";
        slots.forEach(function (s) {
            const full = s.available <= 0;
            const status = cardStatus(s, full);
            const card = document.createElement("button");
            card.type = "button";
            let cardClass = "chronos-card " + status.variant;
            if (full) cardClass += " full";
            if (s.fractional) cardClass += " fraction-30";
            card.className = cardClass;
            card.innerHTML = buildCardHtml(s, status);
            if (!full) {
                card.addEventListener("click", function () { openReserveModal(s); });
            } else {
                card.disabled = true;
            }
            slotsList.appendChild(card);
        });
    }

    function gatherCommitmentData() {
        let selectedFrequency = document.querySelector('input[name="commitmentFreq"]:checked')?.value;

        if (dailyModeActive) {
            selectedFrequency = "DAILY";
        }

        const startOffsetEl = document.querySelector('input[name="startOffset"]:checked');
        const durationEl = document.querySelector('input[name="duration"]:checked');
        const startOffset = startOffsetEl ? parseInt(startOffsetEl.value, 10) : 0;
        const duration = durationEl ? parseInt(durationEl.value, 10) : 60;

        const data = {
            frequency: selectedFrequency || "WEEKLY",
            startTimeOffset: startOffset,
            durationMinutes: duration,
        };

        if (dailyModeActive) {
            data.weekDays = selectedWeekDays.join(",");
        }

        if (data.frequency === "BIWEEKLY" && selectedBiweeklyWeeks) {
            data.biweeklyWeeks = selectedBiweeklyWeeks;
        }

        return data;
    }

    function resetBookingTimeControls() {
        const dur60 = document.getElementById("dur-60");
        const start00 = document.getElementById("start-00");
        if (dur60) dur60.checked = true;
        if (start00) start00.checked = true;
        syncDurationStartRules();
    }

    function syncDurationStartRules() {
        const dur30 = document.getElementById("dur-30");
        const startCol = document.getElementById("startOffsetColumn");
        const start00 = document.getElementById("start-00");
        const start30 = document.getElementById("start-30");
        const start30Label = start30?.nextElementSibling;

        const is30Min = Boolean(dur30?.checked);
        const allowOffset = appSettings.allowOffsetStartTimes;

        if (startCol) {
            startCol.style.display = allowOffset && is30Min ? "" : "none";
        }

        if (!is30Min) {
            if (start00) start00.checked = true;
            if (start30) {
                start30.checked = false;
                start30.disabled = true;
            }
            if (start30Label) start30Label.classList.add("is-disabled");
        } else {
            if (start30) start30.disabled = false;
            if (start30Label) start30Label.classList.remove("is-disabled");
        }
    }

    function applyBookingSettings() {
        const freqs = appSettings.frequencies || ["WEEKLY", "BIWEEKLY", "DAILY"];
        const weeklyRadio = document.getElementById("freq-weekly");
        const biweeklyRadio = document.getElementById("freq-biweekly");
        const weeklyLabel = weeklyRadio?.nextElementSibling;
        const biweeklyLabel = biweeklyRadio?.nextElementSibling;

        if (weeklyRadio) {
            weeklyRadio.disabled = !freqs.includes("WEEKLY");
            if (weeklyLabel) weeklyLabel.style.display = freqs.includes("WEEKLY") ? "" : "none";
        }
        if (biweeklyRadio) {
            biweeklyRadio.disabled = !freqs.includes("BIWEEKLY");
            if (biweeklyLabel) biweeklyLabel.style.display = freqs.includes("BIWEEKLY") ? "" : "none";
        }

        const advSelect = document.getElementById("btn-open-daily-days");
        const dailyEnabled = freqs.includes("DAILY");
        if (advSelect) advSelect.style.display = dailyEnabled ? "" : "none";

        const toggleBtn = document.getElementById("btn-toggle-advanced-freq");
        if (toggleBtn) toggleBtn.style.display = dailyEnabled ? "" : "none";

        const timeContainer = document.getElementById("non-standard-time-container");
        const showTime = appSettings.allowOffsetStartTimes || appSettings.allowThirtyMinuteDurations;
        if (timeContainer) {
            timeContainer.classList.toggle("visible", showTime);
        }

        const offsetCol = document.getElementById("startOffsetColumn");
        const durCol = document.getElementById("durationColumn");
        if (durCol) durCol.style.display = appSettings.allowThirtyMinuteDurations ? "" : "none";

        syncDurationStartRules();

        if (freqs.includes("WEEKLY") && weeklyRadio) {
            weeklyRadio.checked = true;
        } else if (freqs.includes("BIWEEKLY") && biweeklyRadio) {
            biweeklyRadio.checked = true;
        }
    }

    function resetPrimaryFrequency() {
        const freqs = appSettings.frequencies || ["WEEKLY", "BIWEEKLY", "DAILY"];
        const weekly = document.getElementById("freq-weekly");
        const biweekly = document.getElementById("freq-biweekly");
        if (freqs.includes("WEEKLY") && weekly && !weekly.disabled) {
            weekly.checked = true;
        } else if (freqs.includes("BIWEEKLY") && biweekly && !biweekly.disabled) {
            biweekly.checked = true;
        }
    }

    function initBookingControls() {
        const btnToggleFreq = document.getElementById("btn-toggle-advanced-freq");
        const advancedFreqContainer = document.getElementById("advanced-freq-container");
        const btnOpenDaily = document.getElementById("btn-open-daily-days");
        const primaryRadioButtons = document.querySelectorAll('input[name="commitmentFreq"]');

        if (btnToggleFreq && advancedFreqContainer) {
            btnToggleFreq.addEventListener("click", function () {
                const isVisible = advancedFreqContainer.classList.contains("visible");
                if (!isVisible) {
                    advancedFreqContainer.classList.add("visible");
                    btnToggleFreq.textContent = "- Ocultar opciones de frecuencia";
                } else {
                    advancedFreqContainer.classList.remove("visible");
                    btnToggleFreq.textContent = "+ Más opciones de frecuencia";
                }
            });
        }

        if (btnOpenDaily) {
            btnOpenDaily.addEventListener("click", function () {
                openDaySelectModal();
            });
        }

        document.getElementById("selectAllDaysBtn")?.addEventListener("click", function () {
            document.querySelectorAll("#weekdayGrid input[type='checkbox']").forEach(function (input) {
                input.checked = true;
            });
        });

        document.getElementById("confirmDaysBtn")?.addEventListener("click", confirmDaySelection);

        document.getElementById("confirmBiweeklyBtn")?.addEventListener("click", confirmBiweeklySelection);

        document.querySelectorAll("[data-close-day]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                closeModal(daySelectModal);
            });
        });

        document.querySelectorAll("[data-close-biweekly]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                closeBiweeklyModal(true);
            });
        });

        if (daySelectModal) {
            daySelectModal.addEventListener("click", function (e) {
                if (e.target === daySelectModal) closeModal(daySelectModal);
            });
        }

        if (biweeklySelectModal) {
            biweeklySelectModal.addEventListener("click", function (e) {
                if (e.target === biweeklySelectModal) closeBiweeklyModal(true);
            });
        }

        primaryRadioButtons.forEach(function (radio) {
            radio.addEventListener("change", function () {
                if (radio.value === "BIWEEKLY" && radio.checked) {
                    clearDailyMode();
                    openBiweeklySelectModal();
                } else if (radio.value === "WEEKLY" && radio.checked) {
                    clearDailyMode();
                    clearBiweeklySelection();
                }
            });
        });

        document.querySelectorAll('input[name="duration"]').forEach(function (radio) {
            radio.addEventListener("change", syncDurationStartRules);
        });
    }

    function openReserveModal(slot) {
        selectedSlot = slot;
        resetBookingFrequency();
        resetBookingTimeControls();
        document.getElementById("reserveSlotLabel").textContent =
            slot.startTime + " – " + slot.endTime + " · " +
            selectedDayLabel() + " " + formatDateShort(selectedDate());
        applyBookingSettings();
        openModal(reserveModal);
        document.getElementById("resFirstName").focus();
    }

    async function confirmReserve() {
        const firstName = document.getElementById("resFirstName").value.trim();
        const lastName = document.getElementById("resLastName").value.trim();
        const phone = normalizePhone(document.getElementById("resPhone").value);
        const btn = document.getElementById("confirmReserveBtn");
        if (!firstName) return toast("Ingresa tu nombre.", "error");
        if (!lastName) return toast("Ingresa tu apellido.", "error");
        if (!isValidPhone(phone)) return toast("El celular debe tener exactamente 8 dígitos.", "error");
        if (!selectedSlot) return;

        btn.disabled = true;
        btn.textContent = "Agendando…";
        const commitment = gatherCommitmentData();
        if (commitment.frequency === "BIWEEKLY" && !commitment.biweeklyWeeks) {
            toast("Selecciona las semanas de tu guardia quincenal.", "error");
            openBiweeklySelectModal();
            btn.disabled = false;
            btn.textContent = "Confirmar Turno";
            return;
        }
        if (commitment.frequency === "DAILY" && !commitment.weekDays) {
            toast("Selecciona los días de tu guardia diaria.", "error");
            openDaySelectModal();
            btn.disabled = false;
            btn.textContent = "Confirmar Turno";
            return;
        }
        try {
            const payload = {
                slotId: selectedSlot.id,
                userFirstName: firstName,
                userLastName: lastName,
                userPhone: phone,
                date: selectedDate(),
                frequency: commitment.frequency,
                startTimeOffset: commitment.startTimeOffset,
                durationMinutes: commitment.durationMinutes,
            };
            if (commitment.weekDays) payload.weekDays = commitment.weekDays;
            if (commitment.biweeklyWeeks) payload.biweeklyWeeks = commitment.biweeklyWeeks;

            const res = await fetch("/api/reservations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (res.ok) {
                toast("Reserva confirmada.", "success");
                closeModal(reserveModal);
                document.getElementById("resFirstName").value = "";
                document.getElementById("resLastName").value = "";
                document.getElementById("resPhone").value = "";
                selectedSlot = null;
                loadSlots();
            } else {
                toast(data.error || "No se pudo reservar.", "error");
            }
        } catch (e) {
            toast("Error de conexión.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Confirmar Turno";
        }
    }

    async function lookupReservations() {
        const phone = normalizePhone(document.getElementById("myPhone").value);
        const list = document.getElementById("myList");
        if (!isValidPhone(phone)) return toast("El celular debe tener exactamente 8 dígitos.", "error");
        list.innerHTML = '<p class="muted">Buscando…</p>';
        try {
            const res = await fetch("/api/reservations/my?phone=" + encodeURIComponent(phone));
            const data = await res.json();
            const items = data.reservations || [];
            if (!items.length) {
                list.innerHTML = '<p class="muted">No se encontraron reservas.</p>';
                return;
            }
            list.innerHTML = "";
            items.forEach(function (r) {
                const row = document.createElement("div");
                row.className = "my-item status-" + r.status;
                const canCancel = r.status === "confirmed";
                row.innerHTML =
                    "<div><strong>" + r.slot.startTime + "–" + r.slot.endTime + "</strong>" +
                    '<span class="my-date">' + formatDateShort(r.date) + "</span></div>" +
                    '<div class="my-actions"><span class="status-pill">' + statusLabel(r.status) + "</span>" +
                    (canCancel ? '<button type="button" class="mini-btn" data-id="' + r.id + '">Cancelar</button>' : "") +
                    "</div>";
                if (canCancel) {
                    row.querySelector(".mini-btn").addEventListener("click", function () {
                        cancelReservation(r.id, phone, this);
                    });
                }
                list.appendChild(row);
            });
        } catch (e) {
            list.innerHTML = '<p class="muted">Error al buscar.</p>';
        }
    }

    function statusLabel(s) {
        return { confirmed: "Confirmada", completed: "Asistió", cancelled: "Cancelada", no_show: "No asistió" }[s] || s;
    }

    async function cancelReservation(id, phone, btn) {
        btn.disabled = true;
        try {
            const res = await fetch("/api/reservations/" + id, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: phone }),
            });
            const data = await res.json();
            if (res.ok) {
                toast("Reserva cancelada.", "success");
                lookupReservations();
                loadSlots();
            } else {
                toast(data.error || "No se pudo cancelar.", "error");
                btn.disabled = false;
            }
        } catch (e) {
            toast("Error de conexión.", "error");
            btn.disabled = false;
        }
    }

    document.querySelectorAll("[data-close]").forEach(function (b) {
        b.addEventListener("click", function () {
            closeModal(b.closest(".modal-overlay"));
        });
    });

    document.querySelectorAll(".modal-overlay").forEach(function (overlay) {
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) closeModal(overlay);
        });
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeTopModal();
    });

    initTheme();
    initPhoneInputs();
    initBookingControls();
    document.getElementById("themeToggle").addEventListener("click", toggleTheme);
    dayPicker.value = String(todayWeekday());
    initDayCarousel();
    document.getElementById("confirmReserveBtn").addEventListener("click", confirmReserve);
    document.getElementById("myReservationsBtn").addEventListener("click", function () {
        document.getElementById("myList").innerHTML = "";
        openModal(myModal);
        document.getElementById("myPhone").focus();
    });
    document.getElementById("lookupBtn").addEventListener("click", lookupReservations);

    loadSlots();
})();
