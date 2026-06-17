(function () {
    "use strict";

    const toast = window.AdoratioToast || function (m) { alert(m); };
    const TOKEN_KEY = "adoratio_admin_token";

    /** Bitmask — debe coincidir con src/constants/permissions.js */
    const PRIV = {
        DASHBOARD_VIEW:        1 << 0,
        SLOTS_VIEW:            1 << 1,
        SLOTS_CREATE:          1 << 2,
        SLOTS_EDIT:            1 << 3,
        SLOTS_DELETE:          1 << 4,
        RESERVATIONS_VIEW:     1 << 5,
        RESERVATIONS_CHECKIN:  1 << 6,
        RESERVATIONS_EXPORT:   1 << 7,
        QRS_VIEW:              1 << 8,
        QRS_CREATE:            1 << 9,
        QRS_EDIT:              1 << 10,
        QRS_DELETE:            1 << 11,
        CATEGORIES_VIEW:       1 << 12,
        CATEGORIES_MANAGE:     1 << 13,
        PRAYERS_VIEW:          1 << 14,
        PRAYERS_MANAGE:        1 << 15,
        ROLES_VIEW:            1 << 16,
        ROLES_MANAGE:          1 << 17,
        USERS_VIEW:            1 << 18,
        USERS_MANAGE:          1 << 19,
        AUDIT_VIEW:            1 << 20,
    };

    let token = localStorage.getItem(TOKEN_KEY);
    let session = { user: null, permissionNodes: [] };
    let rolesCache = [];
    let selectedRoleId = null;
    let auditOffset = 0;
    const AUDIT_LIMIT = 40;
    let slotsCache = [];
    let reservationsCache = [];
    const resColFilters = {
        slot: "",
        date: "",
        firstName: "",
        lastName: "",
        phone: "",
        status: "",
    };

    function hasPerm(key) {
        const bit = PRIV[key];
        if (!bit || !session.user) return false;
        return (session.user.privileges & bit) === bit;
    }

    function todayStr() {
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    function formatTime(iso) {
        if (!iso) return "—";
        const d = new Date(iso);
        return d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    async function api(path, opts) {
        opts = opts || {};
        opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
        if (token) opts.headers.Authorization = "Bearer " + token;
        const res = await fetch(path, opts);
        if (res.status === 401) {
            logout();
            throw new Error("Sesión expirada");
        }
        return res;
    }

    /** Zero-Trust UI: oculta nodos DOM sin permiso exacto. */
    function applyZeroTrustUI() {
        document.querySelectorAll("[data-perm]").forEach(function (el) {
            const key = el.getAttribute("data-perm");
            if (hasPerm(key)) {
                el.classList.remove("perm-denied");
            } else {
                el.classList.add("perm-denied");
            }
        });
        document.querySelectorAll(".tab-panel[data-perm]").forEach(function (panel) {
            if (panel.classList.contains("perm-denied") && panel.classList.contains("active")) {
                const firstVisible = document.querySelector(".tab:not(.perm-denied)");
                if (firstVisible) firstVisible.click();
            }
        });
    }

    function updateWhoami() {
        const u = session.user;
        if (!u) return;
        const badgeClass = u.isSuperAdmin ? "admin-badge super" : "admin-badge";
        const roleLabel = u.adminRoleName || u.role;
        document.getElementById("whoami").innerHTML =
            escapeHtml(u.name) + ' <span class="' + badgeClass + '">' + escapeHtml(roleLabel) + "</span>";
    }

    async function refreshSession() {
        const res = await api("/api/admin/session");
        if (!res.ok) throw new Error("Sin acceso");
        const data = await res.json();
        session.user = data.user;
        session.permissionNodes = data.permissionNodes || [];
        updateWhoami();
        applyZeroTrustUI();
    }

    // ── AUTH ──
    async function login() {
        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPass").value;
        const btn = document.getElementById("loginBtn");
        btn.disabled = true;
        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) {
                return toast(data.error || "No se pudo iniciar sesión.", "error");
            }
            if (!data.user?.privileges || !(data.user.privileges & PRIV.DASHBOARD_VIEW)) {
                return toast("Tu cuenta no tiene acceso al panel de administración.", "error");
            }
            token = data.token;
            localStorage.setItem(TOKEN_KEY, token);
            session.user = data.user;
            session.permissionNodes = data.permissionNodes || [];
            showDashboard();
        } catch (e) {
            toast("Error de conexión.", "error");
        } finally {
            btn.disabled = false;
        }
    }

    function logout() {
        token = null;
        session = { user: null, permissionNodes: [] };
        localStorage.removeItem(TOKEN_KEY);
        document.getElementById("dashboard").classList.add("hidden");
        document.getElementById("loginView").classList.remove("hidden");
    }

    async function showDashboard() {
        document.getElementById("loginView").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");
        try {
            await refreshSession();
        } catch (e) { return; }
        updateWhoami();
        applyZeroTrustUI();
        document.getElementById("commandDate").textContent = todayStr();
        loadMetrics();
        loadTimeline();
        loadActivity();
    }

    // ── CENTRO DE MANDO ──
    async function loadMetrics() {
        if (!hasPerm("DASHBOARD_VIEW")) return;
        try {
            const res = await api("/api/admin/metrics?date=" + todayStr());
            const m = await res.json();
            const cards = [
                { label: "Turnos activos", value: m.totalSlots },
                { label: "Reservas hoy", value: m.totalReservations },
                { label: "Asistencias", value: m.checkedIn },
                { label: "Pendientes", value: m.pending },
                { label: "Turnos críticos", value: m.criticalSlots, critical: m.criticalSlots > 0 },
                { label: "Escaneos hoy", value: m.scansToday },
            ];
            document.getElementById("metrics").innerHTML = cards.map(function (c, i) {
                return '<div class="metric-card' + (c.critical ? " critical" : "") + '" style="animation-delay:' + (i * 0.05) + 's">' +
                    '<span class="metric-value">' + c.value + '</span>' +
                    '<span class="metric-label">' + c.label + '</span></div>';
            }).join("");
        } catch (e) { /* handled */ }
    }

    function checkTimelineGaps(commitments) {
        let hasFirstHalfCoverage = false;
        let hasSecondHalfCoverage = false;
        commitments.forEach(function (c) {
            const offset = c.startTimeOffset ?? c.offsetMinutes ?? 0;
            const duration = c.durationMinutes ?? 60;
            if (offset === 0 && duration >= 30) hasFirstHalfCoverage = true;
            if ((offset === 0 && duration >= 60) || (offset === 30 && duration >= 30)) {
                hasSecondHalfCoverage = true;
            }
        });
        if (!hasFirstHalfCoverage || !hasSecondHalfCoverage) return "CRITICAL_GAP";
        return "COVERED";
    }

    async function loadTimeline() {
        if (!hasPerm("DASHBOARD_VIEW")) return;
        const feed = document.getElementById("timelineFeed");
        const dateLabel = document.getElementById("timelineDateLabel");
        if (!feed) return;
        const date = todayStr();
        if (dateLabel) dateLabel.textContent = date;
        try {
            const res = await api("/api/admin/timeline?date=" + encodeURIComponent(date));
            const data = await res.json();
            if (!data.blocks?.length) {
                feed.innerHTML = '<div class="empty-state">Sin bloques horarios para hoy.</div>';
                return;
            }
            feed.innerHTML = data.blocks.map(function (block, i) {
                const gapStatus = block.gapStatus || checkTimelineGaps(block.commitments || []);
                let cardClass = "chronos-card";
                if (block.fractional) cardClass += " fraction-30";
                if (gapStatus === "CRITICAL_GAP" || block.gapAlert) cardClass += " gap-alert";
                const names = (block.commitments || []).map(function (c) {
                    const display = [c.userFirstName, c.userLastName].filter(Boolean).join(" ") || c.userName;
                    const detail = [];
                    if (c.startTimeOffset === 30) detail.push(":30");
                    if (c.durationMinutes === 30) detail.push("30 min");
                    if (c.frequency && c.frequency !== "WEEKLY") detail.push(c.frequency);
                    return escapeHtml(display) + (detail.length ? " <span class=\"muted\">(" + detail.join(", ") + ")</span>" : "");
                }).join("<br>") || '<span class="muted">Sin adoradores — Santísimo solo</span>';
                const meta = gapStatus === "CRITICAL_GAP"
                    ? '<span style="color:var(--apple-red-alert)">Hueco de 30 min sin custodia</span>'
                    : (block.commitments?.length || 0) + " adorador" + ((block.commitments?.length || 0) !== 1 ? "es" : "");
                return '<div class="' + cardClass + '" style="animation-delay:' + (i * 0.03) + 's">' +
                    '<div class="time-signature">' + escapeHtml(block.startTime) + "–" + escapeHtml(block.endTime) + '</div>' +
                    '<div class="chronos-body">' +
                    '<div class="chronos-names">' + names + '</div>' +
                    '<div class="chronos-meta">' + meta + '</div></div></div>';
            }).join("");
        } catch (e) {
            feed.innerHTML = '<div class="empty-state">No se pudo cargar el timeline.</div>';
        }
    }

    async function loadSettingsForm() {
        if (!hasPerm("SLOTS_VIEW")) return;
        try {
            const res = await api("/api/admin/settings");
            const data = await res.json();
            const s = data.settings || {};
            const map = {
                setFreqOnce: "freqOnceEnabled",
                setFreqDaily: "freqDailyEnabled",
                setFreqWeekly: "freqWeeklyEnabled",
                setFreqBiweekly: "freqBiweeklyEnabled",
                setFreqMonthly: "freqMonthlyEnabled",
                setAllowOffset: "allowOffsetStartTimes",
                setAllowThirtyMin: "allowThirtyMinuteDurations",
            };
            Object.keys(map).forEach(function (id) {
                const el = document.getElementById(id);
                if (el) el.checked = Boolean(s[map[id]]);
            });
        } catch (e) { /* handled */ }
    }

    async function saveSettingsForm() {
        if (!hasPerm("SLOTS_EDIT")) return;
        const btn = document.getElementById("saveSettingsBtn");
        if (btn) btn.disabled = true;
        try {
            const body = {
                freqOnceEnabled: document.getElementById("setFreqOnce").checked,
                freqDailyEnabled: document.getElementById("setFreqDaily").checked,
                freqWeeklyEnabled: document.getElementById("setFreqWeekly").checked,
                freqBiweeklyEnabled: document.getElementById("setFreqBiweekly").checked,
                freqMonthlyEnabled: document.getElementById("setFreqMonthly").checked,
                allowOffsetStartTimes: document.getElementById("setAllowOffset").checked,
                allowThirtyMinuteDurations: document.getElementById("setAllowThirtyMin").checked,
            };
            const res = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(body) });
            if (res.ok) toast("Configuración guardada.", "success");
            else {
                const data = await res.json();
                toast(data.error || "Error al guardar.", "error");
            }
        } catch (e) {
            toast("Error de conexión.", "error");
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function loadActivity() {
        if (!hasPerm("DASHBOARD_VIEW")) return;
        try {
            const res = await api("/api/admin/activity?limit=12");
            const data = await res.json();
            const feed = document.getElementById("activityFeed");
            if (!data.audits?.length) {
                feed.innerHTML = '<div class="empty-state">Sin actividad registrada aún.</div>';
            } else {
                feed.innerHTML = data.audits.map(function (a, i) {
                    const dotClass = a.action.indexOf("role") >= 0 || a.action.indexOf("user") >= 0 ? "security"
                        : a.action.indexOf("delete") >= 0 ? "critical" : "";
                    return '<div class="activity-item" style="animation-delay:' + (i * 0.04) + 's">' +
                        '<span class="activity-dot ' + dotClass + '"></span>' +
                        '<div class="activity-text"><strong>' + escapeHtml(a.actorName) + '</strong> · ' +
                        escapeHtml(actionLabel(a.action)) + '</div>' +
                        '<span class="activity-meta">' + formatTime(a.createdAt) + '</span></div>';
                }).join("");
            }
            const todayEl = document.getElementById("todayReservations");
            if (!data.recentReservations?.length) {
                todayEl.innerHTML = '<div class="empty-state">Sin reservas hoy.</div>';
            } else {
                todayEl.innerHTML = data.recentReservations.map(function (r, i) {
                    const displayName = [r.userFirstName, r.userLastName].filter(Boolean).join(" ") || r.userName;
                    return '<div class="activity-item" style="animation-delay:' + (i * 0.04) + 's">' +
                        '<span class="activity-dot"></span>' +
                        '<div class="activity-text"><strong>' + escapeHtml(displayName) + '</strong> · ' +
                        escapeHtml(r.slot) + ' · ' + statusLabel(r.status) + '</div>' +
                        '<span class="activity-meta">' + formatTime(r.createdAt) + '</span></div>';
                }).join("");
            }
        } catch (e) { /* handled */ }
    }

    function actionLabel(action) {
        const map = {
            "role.create": "Creó un perfil RBAC",
            "role.update": "Modificó permisos de un perfil",
            "role.delete": "Eliminó un perfil",
            "user.create": "Creó un administrador",
            "user.role.assign": "Asignó un perfil a un usuario",
            "slot.create": "Creó un bloque horario",
            "slot.update": "Modificó un turno",
            "slot.delete": "Eliminó un turno",
            "qr.create": "Generó un QR",
            "qr.update": "Actualizó un QR",
            "qr.deactivate": "Desactivó un QR",
            "qr.batch": "Generó lote de QR",
            "checkin.manual": "Marcó asistencia manual",
            "checkin.scan": "Check-in por QR",
            "reservation.create": "Nueva reserva",
            "reservation.cancel": "Canceló reserva",
            "settings.update": "Actualizó configuración",
        };
        return map[action] || action;
    }

    // ── RESERVAS / PARTICIPANTES ──
    function filterReservations(rows) {
        return rows.filter(function (r) {
            const slotStr = r.slot.startTime + "–" + r.slot.endTime;
            const f = resColFilters;
            if (f.slot && slotStr.toLowerCase().indexOf(f.slot.toLowerCase()) === -1) return false;
            if (f.date && r.date.indexOf(f.date) === -1) return false;
            if (f.firstName && (r.userFirstName || "").toLowerCase().indexOf(f.firstName.toLowerCase()) === -1) return false;
            if (f.lastName && (r.userLastName || "").toLowerCase().indexOf(f.lastName.toLowerCase()) === -1) return false;
            if (f.phone && (r.userPhone || "").indexOf(f.phone) === -1) return false;
            if (f.status && r.status !== f.status) return false;
            return true;
        });
    }

    function updateResCount(count) {
        const el = document.getElementById("resCountBadge");
        if (el) el.textContent = count + (count === 1 ? " participante" : " participantes");
    }

    function initReservationsTable() {
        const table = document.getElementById("resTable");
        if (table.dataset.initialized) return;
        table.dataset.initialized = "1";
        table.innerHTML =
            "<thead>" +
            "<tr>" +
            "<th class='col-num'>#</th>" +
            "<th>Turno</th><th>Fecha</th><th>Nombre</th><th>Apellido</th><th>Celular</th><th>Estado</th><th></th>" +
            "</tr>" +
            "<tr class='filter-row'>" +
            "<th></th>" +
            "<th><input type='text' class='col-filter' data-filter='slot' placeholder='ej. 10:00'></th>" +
            "<th><input type='text' class='col-filter' data-filter='date' placeholder='YYYY-MM-DD'></th>" +
            "<th><input type='text' class='col-filter' data-filter='firstName' placeholder='Buscar…'></th>" +
            "<th><input type='text' class='col-filter' data-filter='lastName' placeholder='Buscar…'></th>" +
            "<th><input type='text' class='col-filter' data-filter='phone' placeholder='Buscar…'></th>" +
            "<th><select class='col-filter' data-filter='status'>" +
            "<option value=''>Todos</option>" +
            "<option value='confirmed'>Confirmada</option>" +
            "<option value='completed'>Asistió</option>" +
            "<option value='cancelled'>Cancelada</option>" +
            "<option value='no_show'>No asistió</option>" +
            "</select></th>" +
            "<th></th>" +
            "</tr></thead><tbody id='resTableBody'></tbody>";

        table.querySelectorAll(".col-filter").forEach(function (input) {
            input.addEventListener("input", onResFilterChange);
            input.addEventListener("change", onResFilterChange);
        });
    }

    function renderReservationsTable() {
        initReservationsTable();
        const filtered = filterReservations(reservationsCache);
        const canCheckin = hasPerm("RESERVATIONS_CHECKIN");
        const tbody = document.getElementById("resTableBody");

        tbody.innerHTML = filtered.length ? filtered.map(function (r, idx) {
            const showBtn = canCheckin && r.status === "confirmed";
            return "<tr><td class='col-num'>" + (idx + 1) + "</td>" +
                "<td>" + r.slot.startTime + "–" + r.slot.endTime + "</td><td>" + r.date + "</td>" +
                "<td>" + escapeHtml(r.userFirstName || "—") + "</td>" +
                "<td>" + escapeHtml(r.userLastName || "—") + "</td>" +
                "<td>" + escapeHtml(r.userPhone) + "</td>" +
                "<td><span class='status-pill status-" + r.status + "'>" + statusLabel(r.status) + "</span></td>" +
                "<td>" + (showBtn ? "<button class='mini-btn' data-checkin='" + r.id + "'>Asistió</button>" : "") + "</td></tr>";
        }).join("") : "<tr><td colspan='8' class='muted'>Sin participantes con estos filtros.</td></tr>";

        updateResCount(filtered.length);

        tbody.querySelectorAll("[data-checkin]").forEach(function (b) {
            b.addEventListener("click", function () { manualCheckin(b.getAttribute("data-checkin")); });
        });
    }

    function onResFilterChange(e) {
        const key = e.target.getAttribute("data-filter");
        if (!key) return;
        resColFilters[key] = e.target.value;
        renderReservationsTable();
    }

    function clearResFilters() {
        Object.keys(resColFilters).forEach(function (k) { resColFilters[k] = ""; });
        document.querySelectorAll("#resTable .col-filter").forEach(function (el) {
            el.value = "";
        });
        renderReservationsTable();
    }

    async function loadReservations() {
        if (!hasPerm("RESERVATIONS_VIEW")) return;
        const scopeDate = document.getElementById("resDateScope").value;
        const qs = new URLSearchParams();
        if (scopeDate) qs.set("date", scopeDate);
        const res = await api("/api/admin/reservations?" + qs.toString());
        const data = await res.json();
        reservationsCache = data.reservations || [];
        renderReservationsTable();
    }

    async function manualCheckin(id) {
        const res = await api("/api/admin/reservations/" + id + "/checkin", { method: "POST" });
        const data = await res.json();
        if (res.ok) { toast("Asistencia registrada.", "success"); loadReservations(); loadMetrics(); loadActivity(); }
        else toast(data.error || "Error.", "error");
    }

    // ── MURO DE INTENCIONES ──
    var intentionsCache = [];

    function whatsAppNotifyUrl(phone) {
        if (!phone) return null;
        const msg = encodeURIComponent(
            "Hola, queremos notificarte que tu petición ha sido orada hoy durante la Adoración."
        );
        return "https://wa.me/506" + phone + "?text=" + msg;
    }

    function formatIntentionDate(iso) {
        try {
            return new Date(iso).toLocaleDateString("es-CR", {
                day: "numeric", month: "short", year: "numeric",
            });
        } catch (_) {
            return "—";
        }
    }

    function renderMuroTable() {
        const table = document.getElementById("muroTable");
        const canNotify = hasPerm("RESERVATIONS_CHECKIN");
        const tbody = intentionsCache;

        table.innerHTML =
            "<thead><tr>" +
            "<th>Intención</th><th>Autor</th><th>Celular</th><th>Fecha</th><th>Estado</th><th></th>" +
            "</tr></thead><tbody>" +
            (tbody.length ? tbody.map(function (i) {
                const waUrl = whatsAppNotifyUrl(i.userPhone);
                const waBtn = waUrl
                    ? "<a href='" + waUrl + "' target='_blank' rel='noopener' class='btn-whatsapp'>Notificar oración</a>"
                    : "<span class='muted'>—</span>";
                const markBtn = canNotify && i.status === "active"
                    ? " <button class='mini-btn' data-prayed='" + i.id + "'>Marcar orada</button>"
                    : "";
                return "<tr>" +
                    "<td class='muro-intention-text'>" + escapeHtml(i.text) + "</td>" +
                    "<td>" + escapeHtml(i.displayName || "Anónimo") + "</td>" +
                    "<td>" + escapeHtml(i.userPhone || "—") + "</td>" +
                    "<td>" + formatIntentionDate(i.createdAt) + "</td>" +
                    "<td><span class='status-pill status-" + (i.status === "prayed" ? "completed" : "confirmed") + "'>" +
                    (i.status === "prayed" ? "Orada" : "Activa") + "</span></td>" +
                    "<td><div class='admin-actions'>" + waBtn + markBtn + "</div></td></tr>";
            }).join("") : "<tr><td colspan='6' class='muted'>Sin intenciones con este filtro.</td></tr>") +
            "</tbody>";

        const badge = document.getElementById("muroCountBadge");
        if (badge) badge.textContent = tbody.length + (tbody.length === 1 ? " intención" : " intenciones");

        table.querySelectorAll("[data-prayed]").forEach(function (b) {
            b.addEventListener("click", function () { markIntentionPrayed(b.getAttribute("data-prayed")); });
        });
    }

    async function loadIntentions() {
        if (!hasPerm("RESERVATIONS_VIEW")) return;
        const status = document.getElementById("muroStatusFilter").value;
        const qs = new URLSearchParams();
        if (status) qs.set("status", status);
        const res = await api("/api/admin/intentions?" + qs.toString());
        const data = await res.json();
        if (!res.ok) {
            toast(data.error || "Error al cargar intenciones.", "error");
            return;
        }
        intentionsCache = data.intentions || [];
        renderMuroTable();
    }

    async function markIntentionPrayed(id) {
        const res = await api("/api/admin/intentions/" + id + "/prayed", { method: "POST" });
        const data = await res.json();
        if (res.ok) {
            toast("Intención marcada como orada.", "success");
            loadIntentions();
        } else {
            toast(data.error || "Error.", "error");
        }
    }

    // ── TURNOS ──
    async function loadSlots() {
        if (!hasPerm("SLOTS_VIEW")) return;
        const res = await api("/api/admin/slots");
        const data = await res.json();
        slotsCache = data.slots || [];
        const canEdit = hasPerm("SLOTS_EDIT");
        const canDelete = hasPerm("SLOTS_DELETE");
        const table = document.getElementById("slotsTable");
        table.innerHTML =
            "<thead><tr><th>Inicio</th><th>Fin</th><th>Cupo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>" +
            slotsCache.map(function (s) {
                let actions = "";
                if (canEdit) {
                    actions += "<button class='mini-btn' data-edit='" + s.id + "'>Editar</button>" +
                        "<button class='mini-btn' data-toggle='" + s.id + "' data-active='" + s.isActive + "'>" +
                        (s.isActive ? "Desactivar" : "Activar") + "</button>";
                }
                if (canDelete) actions += "<button class='mini-btn danger' data-delete='" + s.id + "'>Eliminar</button>";
                return "<tr><td>" + s.startTime + "</td><td>" + s.endTime + "</td><td>" + s.capacity + "</td>" +
                    "<td><span class='status-pill " + (s.isActive ? "status-completed" : "status-cancelled") + "'>" +
                    (s.isActive ? "Activo" : "Inactivo") + "</span></td>" +
                    "<td><div class='admin-actions'>" + (actions || "—") + "</div></td></tr>";
            }).join("") + "</tbody>";
        if (canEdit) {
            table.querySelectorAll("[data-toggle]").forEach(function (b) {
                b.addEventListener("click", function () {
                    toggleSlot(b.getAttribute("data-toggle"), b.getAttribute("data-active") !== "true");
                });
            });
            table.querySelectorAll("[data-edit]").forEach(function (b) {
                b.addEventListener("click", function () { openSlotEditor(b.getAttribute("data-edit")); });
            });
        }
        if (canDelete) {
            table.querySelectorAll("[data-delete]").forEach(function (b) {
                b.addEventListener("click", function () { deleteSlot(b.getAttribute("data-delete")); });
            });
        }
    }

    function openSlotEditor(id) {
        const slot = slotsCache.find(function (s) { return String(s.id) === String(id); });
        if (!slot) return;
        document.getElementById("editSlotId").value = slot.id;
        document.getElementById("editSlotStart").value = slot.startTime;
        document.getElementById("editSlotEnd").value = slot.endTime;
        document.getElementById("editSlotCap").value = slot.capacity;
        document.getElementById("editSlotActive").checked = slot.isActive;
        document.getElementById("slotSheet").classList.add("active");
    }

    async function saveSlot() {
        const id = document.getElementById("editSlotId").value;
        const startTime = document.getElementById("editSlotStart").value.trim();
        const endTime = document.getElementById("editSlotEnd").value.trim();
        const capacity = document.getElementById("editSlotCap").value;
        const isActive = document.getElementById("editSlotActive").checked;
        if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
            return toast("Usa formato HH:MM.", "error");
        }
        const btn = document.getElementById("saveSlotBtn");
        btn.disabled = true;
        try {
            const res = await api("/api/admin/slots/" + id, {
                method: "PUT",
                body: JSON.stringify({ startTime, endTime, capacity, isActive }),
            });
            const data = await res.json();
            if (res.ok) {
                toast("Turno actualizado.", "success");
                document.getElementById("slotSheet").classList.remove("active");
                loadSlots(); loadMetrics(); loadActivity();
            } else toast(data.error || "Error.", "error");
        } finally { btn.disabled = false; }
    }

    async function deleteSlot(id) {
        const slot = slotsCache.find(function (s) { return String(s.id) === String(id); });
        if (!slot || !confirm("¿Eliminar permanentemente el turno " + slot.startTime + "–" + slot.endTime + "?")) return;
        const res = await api("/api/admin/slots/" + id, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) { toast("Turno eliminado.", "success"); loadSlots(); loadMetrics(); }
        else toast(data.error || "No se pudo eliminar.", "error");
    }

    async function addSlot() {
        const startTime = document.getElementById("slotStart").value.trim();
        const endTime = document.getElementById("slotEnd").value.trim();
        const capacity = document.getElementById("slotCap").value;
        if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
            return toast("Usa formato HH:MM.", "error");
        }
        const res = await api("/api/admin/slots", { method: "POST", body: JSON.stringify({ startTime, endTime, capacity }) });
                if (res.ok) { toast("Turno agregado.", "success"); loadSlots(); loadActivity(); loadTimeline(); }
        else { const d = await res.json(); toast(d.error || "Error.", "error"); }
    }

    async function toggleSlot(id, isActive) {
        const res = await api("/api/admin/slots/" + id, { method: "PUT", body: JSON.stringify({ isActive }) });
        if (res.ok) loadSlots();
        else { const d = await res.json(); toast(d.error || "Error.", "error"); }
    }

    // ── QRs ──
    async function loadQrs() {
        if (!hasPerm("QRS_VIEW")) return;
        const res = await api("/api/admin/qrs");
        const data = await res.json();
        const canEdit = hasPerm("QRS_EDIT");
        const table = document.getElementById("qrTable");
        table.innerHTML =
            "<thead><tr><th>Código</th><th>Nombre</th><th>Ubicación</th><th>Estado</th><th>Usos</th><th></th></tr></thead><tbody>" +
            (data.qrs.length ? data.qrs.map(function (q) {
                let btns = "<a class='mini-btn' href='/api/admin/qrs/" + q.id + "/png' target='_blank' rel='noopener'>PNG</a>";
                if (canEdit) {
                    btns += "<button class='mini-btn' data-toggleqr='" + q.id + "' data-active='" + q.isActive + "'>" +
                        (q.isActive ? "Desactivar" : "Activar") + "</button>";
                }
                return "<tr><td><code>" + q.qrCode + "</code></td><td>" + escapeHtml(q.displayName) + "</td>" +
                    "<td>" + escapeHtml(q.location || "—") + "</td>" +
                    "<td><span class='status-pill " + (q.isActive ? "status-completed" : "status-cancelled") + "'>" +
                    (q.isActive ? "Activo" : "Inactivo") + "</span></td><td>" + q.uses + "</td><td>" + btns + "</td></tr>";
            }).join("") : "<tr><td colspan='6' class='muted'>Sin QR.</td></tr>") + "</tbody>";
        if (canEdit) {
            table.querySelectorAll("[data-toggleqr]").forEach(function (b) {
                b.addEventListener("click", function () {
                    toggleQr(b.getAttribute("data-toggleqr"), b.getAttribute("data-active") !== "true");
                });
            });
        }
        table.querySelectorAll("a.mini-btn[href]").forEach(function (a) {
            a.addEventListener("click", function (e) { e.preventDefault(); downloadPng(a.getAttribute("href")); });
        });
    }

    async function downloadPng(path) {
        try {
            const res = await api(path);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = path.split("/").slice(-2)[0] + ".png";
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { toast("No se pudo descargar.", "error"); }
    }

    async function toggleQr(id, isActive) {
        const res = await api("/api/admin/qrs/" + id, { method: "PUT", body: JSON.stringify({ isActive }) });
        if (res.ok) loadQrs();
        else { const d = await res.json(); toast(d.error || "Error.", "error"); }
    }

    async function createQr() {
        const displayName = document.getElementById("qrName").value.trim();
        const location = document.getElementById("qrLocation").value.trim();
        if (!displayName) return toast("Ingresa un nombre.", "error");
        const res = await api("/api/admin/qrs", { method: "POST", body: JSON.stringify({ displayName, location }) });
        const data = await res.json();
        if (res.ok) {
            document.getElementById("qrPreview").innerHTML =
                '<img src="' + data.image + '" alt="QR">' +
                '<code>' + data.qr.qrCode + '</code>';
            toast("QR generado.", "success");
            loadQrs(); loadActivity();
        } else toast(data.error || "No se pudo generar.", "error");
    }

    async function printBatch() {
        try {
            const res = await api("/api/admin/qrs/print-batch?count=10");
            if (!res.ok) { const d = await res.json(); return toast(d.error || "Error.", "error"); }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "qrs-para-imprimir.pdf";
            a.click();
            URL.revokeObjectURL(url);
            toast("Lote generado.", "success");
            loadQrs(); loadActivity();
        } catch (e) { toast("No se pudo generar el lote.", "error"); }
    }

    async function exportCsv() {
        const qs = new URLSearchParams();
        const scopeDate = document.getElementById("resDateScope").value;
        if (scopeDate) qs.set("date", scopeDate);
        if (resColFilters.firstName) qs.set("firstName", resColFilters.firstName);
        if (resColFilters.lastName) qs.set("lastName", resColFilters.lastName);
        if (resColFilters.phone) qs.set("phone", resColFilters.phone);
        if (resColFilters.status) qs.set("status", resColFilters.status);
        if (resColFilters.slot) qs.set("slotTime", resColFilters.slot);
        if (resColFilters.date) qs.set("date", resColFilters.date);
        const path = "/api/admin/reports/reservations.csv" + (qs.toString() ? "?" + qs.toString() : "");
        try {
            const res = await api(path);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "reservas.csv";
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { toast("No se pudo exportar.", "error"); }
    }

    // ── RBAC: PERFILES ──
    function buildPermissionMatrixHTML(nodes, privileges, prefix, readonly) {
        let html = "";
        (nodes || session.permissionNodes).forEach(function (mod) {
            html += '<div class="permission-module"><h4 class="permission-module-title">' + escapeHtml(mod.label) + '</h4>';
            mod.nodes.forEach(function (node) {
                const checked = (privileges & node.bit) === node.bit;
                const id = prefix + node.key;
                html += '<div class="permission-row"><span class="permission-label">' + escapeHtml(node.label) + '</span>' +
                    '<label class="perm-toggle"><input type="checkbox" id="' + id + '" data-bit="' + node.bit + '"' +
                    (checked ? " checked" : "") + (readonly ? " disabled" : "") + '>' +
                    '<span class="perm-toggle-track"></span></label></div>';
            });
            html += "</div>";
        });
        return html;
    }

    function readPrivilegesFromMatrix(container) {
        let mask = 0;
        container.querySelectorAll("input[data-bit]:checked").forEach(function (cb) {
            mask |= Number(cb.getAttribute("data-bit"));
        });
        return mask;
    }

    async function loadRoles() {
        if (!hasPerm("ROLES_VIEW")) return;
        const res = await api("/api/admin/roles");
        const data = await res.json();
        rolesCache = data.roles || [];
        const list = document.getElementById("roleList");
        list.innerHTML = rolesCache.map(function (r) {
            return '<button type="button" class="role-chip' + (selectedRoleId === r.id ? " active" : "") + '" data-role="' + r.id + '">' +
                '<span class="role-chip-name">' + escapeHtml(r.name) + '</span>' +
                '<span class="role-chip-meta">' + r.userCount + ' admin · ' + r.permissionKeys.length + ' permisos</span>' +
                (r.isSystem ? '<span class="role-chip-badge">Sistema</span>' : "") +
                "</button>";
        }).join("");
        list.querySelectorAll("[data-role]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                selectedRoleId = Number(btn.getAttribute("data-role"));
                loadRoles();
                renderRoleEditor(selectedRoleId);
            });
        });
        if (!selectedRoleId && rolesCache.length) {
            selectedRoleId = rolesCache[0].id;
            renderRoleEditor(selectedRoleId);
        }
    }

    function renderRoleEditor(roleId) {
        const role = rolesCache.find(function (r) { return r.id === roleId; });
        const editor = document.getElementById("roleEditor");
        if (!role) {
            editor.innerHTML = '<div class="empty-state">Selecciona un perfil.</div>';
            return;
        }
        const canManage = hasPerm("ROLES_MANAGE");
        const isLocked = role.isSystem && role.slug === "super-admin";
        const readonly = !canManage || isLocked;

        editor.innerHTML =
            '<h3 style="margin:0 0 4px;font-family:var(--admin-serif);font-size:1.4rem;">' + escapeHtml(role.name) + '</h3>' +
            '<p class="muted" style="margin:0 0 20px;font-size:0.86rem;">' + escapeHtml(role.description || "") + '</p>' +
            buildPermissionMatrixHTML(session.permissionNodes, role.privileges, "edit-", readonly) +
            (canManage && !isLocked ? '<div class="role-editor-actions">' +
                '<button class="sheet-primary-btn" id="saveRoleEditorBtn">Guardar permisos</button>' +
                (!role.isSystem ? '<button class="sheet-primary-btn danger-outline" id="deleteRoleBtn">Eliminar perfil</button>' : "") +
                "</div>" : (isLocked ? '<p class="muted" style="margin-top:16px;font-size:0.82rem;">Perfil de sistema protegido.</p>' : ""));

        const saveBtn = document.getElementById("saveRoleEditorBtn");
        if (saveBtn) {
            saveBtn.addEventListener("click", function () { saveRoleEditor(role.id); });
        }
        const delBtn = document.getElementById("deleteRoleBtn");
        if (delBtn) {
            delBtn.addEventListener("click", function () { deleteRole(role.id); });
        }
    }

    async function saveRoleEditor(id) {
        const editor = document.getElementById("roleEditor");
        const privileges = readPrivilegesFromMatrix(editor);
        const res = await api("/api/admin/roles/" + id, {
            method: "PUT",
            body: JSON.stringify({ privileges }),
        });
        const data = await res.json();
        if (res.ok) {
            toast("Permisos actualizados.", "success");
            loadRoles(); loadActivity();
        } else toast(data.error || "Error.", "error");
    }

    async function deleteRole(id) {
        const role = rolesCache.find(function (r) { return r.id === id; });
        if (!role || !confirm("¿Eliminar el perfil «" + role.name + "»?")) return;
        const res = await api("/api/admin/roles/" + id, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) {
            toast("Perfil eliminado.", "success");
            selectedRoleId = null;
            loadRoles(); loadActivity();
        } else toast(data.error || "Error.", "error");
    }

    function openNewRoleSheet() {
        document.getElementById("roleSheetTitle").textContent = "Nuevo perfil";
        document.getElementById("roleName").value = "";
        document.getElementById("roleDesc").value = "";
        document.getElementById("roleSheetMatrix").innerHTML =
            buildPermissionMatrixHTML(session.permissionNodes, 0, "new-", false);
        document.getElementById("roleSheet").classList.add("active");
    }

    async function saveNewRole() {
        const name = document.getElementById("roleName").value.trim();
        const description = document.getElementById("roleDesc").value.trim();
        const matrix = document.getElementById("roleSheetMatrix");
        const privileges = readPrivilegesFromMatrix(matrix);
        if (!name) return toast("Ingresa un nombre.", "error");
        const res = await api("/api/admin/roles", {
            method: "POST",
            body: JSON.stringify({ name, description, privileges }),
        });
        const data = await res.json();
        if (res.ok) {
            toast("Perfil creado.", "success");
            document.getElementById("roleSheet").classList.remove("active");
            selectedRoleId = data.role.id;
            loadRoles(); loadActivity();
        } else toast(data.error || "Error.", "error");
    }

    // ── ADMINISTRADORES ──
    async function loadAdmins() {
        if (!hasPerm("USERS_VIEW")) return;
        const res = await api("/api/admin/users");
        const data = await res.json();
        const canManage = hasPerm("USERS_MANAGE");
        const table = document.getElementById("adminsTable");
        table.innerHTML =
            "<thead><tr><th>Nombre</th><th>Correo</th><th>Perfil RBAC</th><th>Desde</th>" +
            (canManage ? "<th></th>" : "") + "</tr></thead><tbody>" +
            (data.users.length ? data.users.map(function (u) {
                return "<tr><td>" + escapeHtml(u.name) + "</td><td>" + escapeHtml(u.email) + "</td>" +
                    "<td>" + escapeHtml(u.adminRoleName || u.role) + "</td>" +
                    "<td>" + formatTime(u.createdAt) + "</td>" +
                    (canManage ? "<td><select class='touch-input-field dark-input' data-assign='" + u.id + "' style='min-width:160px;'>" +
                        rolesCache.map(function (r) {
                            return "<option value='" + r.id + "'" + (r.id === u.adminRoleId ? " selected" : "") + ">" +
                                escapeHtml(r.name) + "</option>";
                        }).join("") + "</select></td>" : "") + "</tr>";
            }).join("") : "<tr><td colspan='5' class='muted'>Sin administradores.</td></tr>") +
            "</tbody>";
        if (canManage) {
            table.querySelectorAll("[data-assign]").forEach(function (sel) {
                sel.addEventListener("change", function () {
                    assignRole(Number(sel.getAttribute("data-assign")), Number(sel.value));
                });
            });
        }
    }

    async function assignRole(userId, adminRoleId) {
        const res = await api("/api/admin/users/" + userId + "/role", {
            method: "PUT",
            body: JSON.stringify({ adminRoleId }),
        });
        const data = await res.json();
        if (res.ok) {
            toast("Perfil asignado.", "success");
            loadAdmins(); loadActivity();
        } else toast(data.error || "Error.", "error");
    }

    async function openAdminSheet() {
        if (!rolesCache.length) {
            const res = await api("/api/admin/roles");
            rolesCache = (await res.json()).roles || [];
        }
        const sel = document.getElementById("adminRoleSelect");
        sel.innerHTML = rolesCache.map(function (r) {
            return "<option value='" + r.id + "'>" + escapeHtml(r.name) + "</option>";
        }).join("");
        document.getElementById("adminSheet").classList.add("active");
    }

    async function createAdmin() {
        const name = document.getElementById("adminName").value.trim();
        const email = document.getElementById("adminEmail").value.trim();
        const password = document.getElementById("adminPassword").value;
        const adminRoleId = document.getElementById("adminRoleSelect").value;
        if (!name || !email || !password) return toast("Completa todos los campos.", "error");
        const res = await api("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({ name, email, password, adminRoleId: Number(adminRoleId) }),
        });
        const data = await res.json();
        if (res.ok) {
            toast("Administrador creado.", "success");
            document.getElementById("adminSheet").classList.remove("active");
            loadAdmins(); loadActivity();
        } else toast(data.error || "Error.", "error");
    }

    // ── AUDITORÍA ──
    async function loadAudit() {
        if (!hasPerm("AUDIT_VIEW")) return;
        const filter = document.getElementById("auditFilter").value.trim();
        const qs = new URLSearchParams({ limit: AUDIT_LIMIT, offset: auditOffset });
        if (filter) qs.set("action", filter);
        const res = await api("/api/admin/audit-logs?" + qs.toString());
        const data = await res.json();
        const table = document.getElementById("auditTable");
        table.innerHTML =
            "<thead><tr><th>Fecha</th><th>Acción</th><th>Actor</th><th>Detalle</th><th>IP</th></tr></thead><tbody>" +
            (data.logs.length ? data.logs.map(function (l) {
                const actionClass = l.action.indexOf("role") >= 0 || l.action.indexOf("user") >= 0 ? "role"
                    : l.action.indexOf("slot") >= 0 ? "slot"
                    : l.action.indexOf("delete") >= 0 ? "security" : "";
                const detail = l.target ? "→ " + escapeHtml(l.target.name) : (l.meta ? escapeHtml(JSON.stringify(l.meta)) : "—");
                return "<tr><td>" + formatTime(l.createdAt) + "</td>" +
                    "<td><span class='audit-action " + actionClass + "'>" + escapeHtml(l.action) + "</span></td>" +
                    "<td>" + escapeHtml(l.actor?.name || "Sistema") + "</td>" +
                    "<td style='max-width:240px;overflow:hidden;text-overflow:ellipsis;'>" + detail + "</td>" +
                    "<td>" + escapeHtml(l.ipAddress || "—") + "</td></tr>";
            }).join("") : "<tr><td colspan='5' class='muted'>Sin registros.</td></tr>") +
            "</tbody>";
        document.getElementById("auditPageInfo").textContent =
            (auditOffset + 1) + "–" + Math.min(auditOffset + AUDIT_LIMIT, data.total) + " de " + data.total;
    }

    // ── Helpers ──
    function statusLabel(s) {
        return { confirmed: "Confirmada", completed: "Asistió", cancelled: "Cancelada", no_show: "No asistió" }[s] || s;
    }

    function setupTabs() {
        document.querySelectorAll(".tab").forEach(function (tab) {
            tab.addEventListener("click", function () {
                if (tab.classList.contains("perm-denied")) return;
                document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
                document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
                tab.classList.add("active");
                const name = tab.getAttribute("data-tab");
                document.getElementById("tab-" + name).classList.add("active");
                const loaders = {
                    resumen: function () { loadMetrics(); loadActivity(); },
                    reservas: loadReservations,
                    muro: loadIntentions,
                    turnos: function () { loadSettingsForm(); loadSlots(); },
                    qrs: loadQrs,
                    perfiles: loadRoles,
                    admins: function () { loadRoles().then(loadAdmins); },
                    auditoria: loadAudit,
                };
                if (loaders[name]) loaders[name]();
            });
        });
    }

    // ── Eventos ──
    document.getElementById("loginBtn").addEventListener("click", login);
    document.getElementById("loginPass").addEventListener("keydown", function (e) { if (e.key === "Enter") login(); });
    document.getElementById("logoutBtn").addEventListener("click", logout);
    document.getElementById("resLoadBtn").addEventListener("click", loadReservations);
    document.getElementById("resClearFilters").addEventListener("click", clearResFilters);
    document.getElementById("muroLoadBtn").addEventListener("click", loadIntentions);
    document.getElementById("muroStatusFilter").addEventListener("change", loadIntentions);
    document.getElementById("exportCsv").addEventListener("click", exportCsv);
    document.getElementById("addSlot").addEventListener("click", addSlot);
    document.getElementById("saveSettingsBtn").addEventListener("click", saveSettingsForm);
    document.getElementById("saveSlotBtn").addEventListener("click", saveSlot);
    document.getElementById("newQrBtn").addEventListener("click", function () { document.getElementById("qrSheet").classList.add("active"); });
    document.getElementById("printBatchBtn").addEventListener("click", printBatch);
    document.getElementById("createQrBtn").addEventListener("click", createQr);
    document.getElementById("newRoleBtn").addEventListener("click", openNewRoleSheet);
    document.getElementById("saveRoleBtn").addEventListener("click", saveNewRole);
    document.getElementById("newAdminBtn").addEventListener("click", openAdminSheet);
    document.getElementById("createAdminBtn").addEventListener("click", createAdmin);
    document.getElementById("auditRefresh").addEventListener("click", function () { auditOffset = 0; loadAudit(); });
    document.getElementById("auditFilter").addEventListener("keydown", function (e) {
        if (e.key === "Enter") { auditOffset = 0; loadAudit(); }
    });
    document.getElementById("auditPrev").addEventListener("click", function () {
        auditOffset = Math.max(0, auditOffset - AUDIT_LIMIT);
        loadAudit();
    });
    document.getElementById("auditNext").addEventListener("click", function () {
        auditOffset += AUDIT_LIMIT;
        loadAudit();
    });
    document.querySelectorAll("[data-close]").forEach(function (b) {
        b.addEventListener("click", function () { b.closest(".premium-sheet-overlay").classList.remove("active"); });
    });

    setupTabs();
    document.getElementById("resDateScope").value = todayStr();

    if (token) showDashboard();
})();
