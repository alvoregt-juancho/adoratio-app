(function () {
    "use strict";

    const toast = window.AdoratioToast || function (m) { alert(m); };
    const TOKEN_KEY = "adoratio_admin_token";
    const HINTS_DISABLED_PREFIX = "adoratio_hints_disabled_";

    /** Textos de onboarding — clave = data-hint-key en el HTML */
    const ONBOARDING_HINTS = {
        "tab-resumen": "Panel principal: métricas del día, timeline de guardias y actividad reciente.",
        "tab-reservas": "Adoradores con guardia en el período elegido. Incluye compromisos recurrentes (semanal, diario, etc.).",
        "tab-muro": "Intenciones de oración enviadas por feligreses. Marca las oradas cuando se cumplan.",
        "tab-turnos": "Gestión de horarios: calendario visual, lista de capitanes/sustitutos y configuración de turnos.",
        "tab-qrs": "Un solo QR de capilla para validar asistencia. Imprímelo en la entrada.",
        "tab-perfiles": "Define qué puede ver y hacer cada rol en el back-office (permisos RBAC).",
        "tab-admins": "Usuarios con acceso al panel y el perfil RBAC asignado a cada uno.",
        "tab-auditoria": "Historial de acciones para trazabilidad, seguridad y revisión de cambios.",
        "section-resumen": "Resumen en tiempo real del estado de la capilla: ocupación, asistencias y alertas del día.",
        "timeline-panel": "Línea de tiempo de guardias de hoy. Detecta huecos sin adorador asignado.",
        "section-reservas": "Filtra por semana o mes y exporta la lista para reportes o seguimiento pastoral.",
        "res-view-week": "Muestra adoradores con guardia en los 7 días del rango seleccionado.",
        "res-view-month": "Vista mensual: útil para planificación y cobertura a largo plazo.",
        "res-clear-filters": "Quita filtros de columna (nombre, teléfono, estado) y muestra todos los resultados.",
        "export-csv": "Descarga un archivo CSV con las reservas del período visible en la tabla.",
        "section-muro": "Intenciones publicadas en el muro de oración de la capilla.",
        "muro-filter": "Filtra intenciones activas, ya oradas o muestra todas.",
        "turnos-calendario": "Cuadrícula semanal o mensual con adoradores por franja y alertas de huecos.",
        "turnos-lista": "Lista de compromisos, capitanes y sustitutos filtrable por día y hora.",
        "turnos-directorio": "Directorio completo de adoradores con filtros por nombre, teléfono y día.",
        "turnos-config": "Configura frecuencias permitidas, horarios de turno y cupos por franja.",
        "cal-needs": "Cantidad de franjas horarias sin cobertura suficiente en el período.",
        "roster-message": "Copia al portapapeles los teléfonos del grupo para enviar un mensaje grupal.",
        "roster-export": "Exporta la sección visible (turnos, capitanes o sustitutos) a CSV.",
        "new-captain": "Registra un capitán responsable de un día u hora específicos.",
        "new-substitute": "Registra un sustituto disponible para cubrir ausencias.",
        "slot-settings": "Opciones globales: qué frecuencias de compromiso y duraciones están permitidas.",
        "add-slot": "Crea una nueva franja horaria (inicio, fin y cupo máximo de adoradores).",
        "section-qrs": "QR único de la capilla. Todos los adoradores escanean el mismo código al llegar.",
        "print-chapel-qr": "Descarga el PNG listo para imprimir y colocar en la entrada.",
        "replace-chapel-qr": "Genera un código nuevo; el anterior deja de funcionar (útil si se filtró o perdió).",
        "new-role": "Crea un perfil personalizado con permisos a la medida.",
        "section-perfiles": "Selecciona un perfil a la izquierda y ajusta sus permisos en la matriz de la derecha.",
        "new-admin": "Da de alta un usuario con acceso al back-office y asígnale un perfil RBAC.",
        "audit-demo": "Zona temporal: borra datos operativos y carga demo (solo Super Admin).",
        "audit-refresh": "Actualiza el listado de auditoría con el filtro de acción actual.",
        "hints-toggle": "Activa u oculta los consejos al pasar el mouse. La preferencia se guarda en este navegador.",
    };

    let hintTooltipEl = null;
    let hintHideTimer = null;
    let hintActiveEl = null;

    function hintsStorageKey() {
        const id = session.user?.id;
        return id ? HINTS_DISABLED_PREFIX + id : null;
    }

    function areHintsEnabled() {
        const key = hintsStorageKey();
        if (!key) return true;
        return localStorage.getItem(key) !== "1";
    }

    function setHintsEnabled(enabled) {
        const key = hintsStorageKey();
        if (!key) return;
        if (enabled) localStorage.removeItem(key);
        else localStorage.setItem(key, "1");
        syncHintsUi();
    }

    function syncHintsUi() {
        const on = areHintsEnabled();
        document.body.classList.toggle("hints-enabled", on);
        const btn = document.getElementById("hintsToggleBtn");
        if (btn) {
            btn.textContent = on ? "Ocultar guía" : "Mostrar guía";
            btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
        if (!on) hideOnboardHint(true);
    }

    function ensureHintTooltip() {
        if (!hintTooltipEl) {
            hintTooltipEl = document.createElement("div");
            hintTooltipEl.id = "onboardHintTooltip";
            hintTooltipEl.className = "onboard-hint-tooltip";
            hintTooltipEl.setAttribute("role", "tooltip");
            hintTooltipEl.innerHTML =
                '<p class="onboard-hint-text"></p>' +
                '<button type="button" class="onboard-hint-dismiss">Desactivar guía</button>';
            hintTooltipEl.querySelector(".onboard-hint-dismiss").addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                setHintsEnabled(false);
                hideOnboardHint(true);
                toast("Guía desactivada en este navegador. Reactívala con «Mostrar guía».", "success");
            });
            hintTooltipEl.addEventListener("mouseenter", function () {
                clearTimeout(hintHideTimer);
            });
            hintTooltipEl.addEventListener("mouseleave", function () {
                hideOnboardHint();
            });
            document.body.appendChild(hintTooltipEl);
        }
        return hintTooltipEl;
    }

    function positionHintTooltip(el) {
        const tip = ensureHintTooltip();
        const rect = el.getBoundingClientRect();
        const margin = 10;
        let top = rect.bottom + margin;
        let left = rect.left + rect.width / 2 - tip.offsetWidth / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - tip.offsetWidth - margin));
        if (top + tip.offsetHeight > window.innerHeight - margin) {
            top = rect.top - tip.offsetHeight - margin;
        }
        tip.style.top = Math.max(margin, top) + "px";
        tip.style.left = left + "px";
    }

    function showOnboardHint(el) {
        if (!areHintsEnabled() || !el) return;
        const key = el.getAttribute("data-hint-key");
        const text = ONBOARDING_HINTS[key];
        if (!text) return;
        clearTimeout(hintHideTimer);
        hintActiveEl = el;
        const tip = ensureHintTooltip();
        const textEl = tip.querySelector(".onboard-hint-text");
        if (textEl) textEl.textContent = text;
        tip.classList.add("visible");
        positionHintTooltip(el);
    }

    function hideOnboardHint(immediate) {
        clearTimeout(hintHideTimer);
        const run = function () {
            if (hintTooltipEl) hintTooltipEl.classList.remove("visible");
            hintActiveEl = null;
        };
        if (immediate) run();
        else hintHideTimer = setTimeout(run, 220);
    }

    function setupOnboardingHints() {
        const dashboard = document.getElementById("dashboard");
        const toggleBtn = document.getElementById("hintsToggleBtn");
        if (!dashboard || dashboard.dataset.hintsBound) return;
        dashboard.dataset.hintsBound = "1";

        if (toggleBtn) {
            toggleBtn.setAttribute("data-hint-key", "hints-toggle");
            toggleBtn.addEventListener("click", function () {
                const next = !areHintsEnabled();
                setHintsEnabled(next);
                toast(
                    next ? "Guía de onboarding activada." : "Guía oculta. Puedes reactivarla con «Mostrar guía».",
                    "success"
                );
            });
        }

        dashboard.addEventListener("mouseover", function (e) {
            if (!areHintsEnabled()) return;
            const el = e.target.closest("[data-hint-key]");
            if (!el || !dashboard.contains(el)) return;
            if (el === hintActiveEl) return;
            showOnboardHint(el);
        });

        dashboard.addEventListener("mouseout", function (e) {
            const el = e.target.closest("[data-hint-key]");
            if (!el || el !== hintActiveEl) return;
            const rel = e.relatedTarget;
            if (rel && (el.contains(rel) || hintTooltipEl?.contains(rel))) return;
            hideOnboardHint();
        });

        window.addEventListener("scroll", function () {
            if (hintActiveEl && hintTooltipEl?.classList.contains("visible")) {
                positionHintTooltip(hintActiveEl);
            }
        }, true);
    }

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
    let calendarState = { view: "week", anchor: todayStr() };
    let resScopeState = { view: "week", anchor: todayStr() };
    let calendarCache = null;
    let adoradoresCache = [];
    let rosterCache = { commitments: [], captains: [], substitutes: [], slotTimes: [] };
    const dirColFilters = {
        firstName: "",
        lastName: "",
        phone: "",
        weekday: "",
    };
    const resColFilters = {
        slot: "",
        date: "",
        firstName: "",
        lastName: "",
        phone: "",
        status: "",
    };
    let metricsCache = null;
    let activeMetricKey = null;

    const METRIC_CARDS = [
        { key: "active-slots", detailKey: "activeSlots", label: "Turnos activos", valueKey: "totalSlots" },
        { key: "reservations-today", detailKey: "reservationsToday", label: "Reservas hoy", valueKey: "totalReservations" },
        { key: "checked-in", detailKey: "checkedIn", label: "Asistencias", valueKey: "checkedIn" },
        { key: "pending", detailKey: "pending", label: "Pendientes", valueKey: "pending" },
        { key: "critical-slots", detailKey: "criticalSlots", label: "Turnos críticos", valueKey: "criticalSlots", critical: true },
        { key: "scans-today", detailKey: "scansToday", label: "Escaneos hoy", valueKey: "scansToday" },
    ];

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
        const demoZone = document.getElementById("auditDemoZone");
        if (demoZone) {
            demoZone.classList.toggle("hidden", !(session.user && session.user.isSuperAdmin));
        }
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
        syncHintsUi();
        document.getElementById("commandDate").textContent = todayStr();
        loadMetrics();
        loadTimeline();
        loadActivity();
    }

    // ── CENTRO DE MANDO ──
    function closeMetricDetail() {
        activeMetricKey = null;
        const panel = document.getElementById("metricDetailPanel");
        if (panel) panel.classList.add("hidden");
        document.querySelectorAll(".metric-card.active").forEach(function (el) {
            el.classList.remove("active");
        });
    }

    function renderMetricDetailList(items, type) {
        if (!items || !items.length) {
            return '<div class="empty-state">Sin registros para mostrar.</div>';
        }
        if (type === "activeSlots" || type === "criticalSlots") {
            return '<ul class="metric-detail-list">' + items.map(function (s) {
                const label = s.label ? " · " + escapeHtml(s.label) : "";
                return "<li><strong>" + escapeHtml(s.startTime) + "–" + escapeHtml(s.endTime) + "</strong>" +
                    label + ' <span class="muted">cupo ' + s.capacity + "</span></li>";
            }).join("") + "</ul>";
        }
        if (type === "scansToday") {
            return '<ul class="metric-detail-list">' + items.map(function (s) {
                const time = formatTime(s.scannedAt);
                const who = s.adorerName ? escapeHtml(s.adorerName) : "—";
                const status = s.success
                    ? '<span class="status-pill status-completed">OK</span>'
                    : '<span class="status-pill status-cancelled">Falló</span>';
                const err = s.errorMessage ? ' <span class="muted">(' + escapeHtml(s.errorMessage) + ")</span>" : "";
                return "<li>" + status + " <strong>" + time + "</strong> — " + who + err + "</li>";
            }).join("") + "</ul>";
        }
        return '<ul class="metric-detail-list">' + items.map(function (r) {
            const checkin = r.checkedInAt
                ? ' <span class="muted">· ingreso ' + formatTime(r.checkedInAt) + "</span>"
                : "";
            return "<li><strong>" + escapeHtml(r.slot) + "</strong> — " + escapeHtml(r.name) +
                ' <span class="muted">' + escapeHtml(r.phone) + "</span>" +
                ' <span class="status-pill status-' + r.status + '">' + statusLabel(r.status) + "</span>" +
                checkin + "</li>";
        }).join("") + "</ul>";
    }

    function metricDetailIntro(key) {
        const intros = {
            "active-slots": "Franjas horarias activas en la capilla (configuración de turnos).",
            "reservations-today": "Compromisos con fecha de hoy, cualquier estado registrado.",
            "checked-in": "Adoradores que ya validaron su visita hoy (QR o marcado manual).",
            "pending": "Guardias confirmadas de hoy que aún no registran asistencia.",
            "critical-slots": "Franjas de hoy sin ningún adorador asignado.",
            "scans-today": "Intentos de escaneo del QR de capilla en el día.",
        };
        return intros[key] || "";
    }

    function showMetricDetail(key) {
        if (!metricsCache?.details) return;
        const def = METRIC_CARDS.find(function (c) { return c.key === key; });
        if (!def) return;

        if (activeMetricKey === key) {
            closeMetricDetail();
            return;
        }

        activeMetricKey = key;
        const items = metricsCache.details[def.detailKey] || [];
        const panel = document.getElementById("metricDetailPanel");
        const title = document.getElementById("metricDetailTitle");
        const body = document.getElementById("metricDetailBody");

        document.querySelectorAll(".metric-card").forEach(function (el) {
            el.classList.toggle("active", el.getAttribute("data-metric-key") === key);
        });

        if (title) title.textContent = def.label + " · " + (metricsCache.date || todayStr());
        if (body) {
            body.innerHTML =
                '<p class="metric-detail-intro muted">' + escapeHtml(metricDetailIntro(key)) + "</p>" +
                renderMetricDetailList(items, def.detailKey);
        }
        if (panel) {
            panel.classList.remove("hidden");
            panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }

    async function loadMetrics() {
        if (!hasPerm("DASHBOARD_VIEW")) return;
        try {
            const res = await api("/api/admin/metrics?date=" + todayStr());
            const m = await res.json();
            if (!res.ok) return;
            metricsCache = m;

            const grid = document.getElementById("metrics");
            grid.innerHTML = METRIC_CARDS.map(function (c, i) {
                const value = m[c.valueKey] ?? 0;
                const isCritical = c.critical && value > 0;
                return '<button type="button" class="metric-card metric-card--clickable' +
                    (isCritical ? " critical" : "") +
                    (activeMetricKey === c.key ? " active" : "") +
                    '" data-metric-key="' + c.key + '" style="animation-delay:' + (i * 0.05) + 's"' +
                    ' aria-pressed="' + (activeMetricKey === c.key ? "true" : "false") + '">' +
                    '<span class="metric-value">' + value + '</span>' +
                    '<span class="metric-label">' + escapeHtml(c.label) + "</span>" +
                    '<span class="metric-hint">Ver detalle</span></button>';
            }).join("");

            grid.querySelectorAll("[data-metric-key]").forEach(function (btn) {
                btn.addEventListener("click", function () {
                    showMetricDetail(btn.getAttribute("data-metric-key"));
                });
            });

            if (activeMetricKey) showMetricDetail(activeMetricKey);
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
            "qr.chapel.replace": "Reemplazó QR de capilla",
            "checkin.manual": "Marcó asistencia manual",
            "checkin.scan": "Check-in por QR",
            "reservation.create": "Nueva reserva",
            "reservation.cancel": "Canceló reserva",
            "settings.update": "Actualizó configuración",
            "demo.reset": "Reseteó datos de demostración",
        };
        return map[action] || action;
    }

    const FREQUENCY_SHORT = {
        ONCE: "Una vez",
        DAILY: "Diario",
        WEEKLY: "Semanal",
        BIWEEKLY: "Quincenal",
        MONTHLY: "Mensual",
    };

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
            const showBtn = canCheckin && r.status === "confirmed" && r.date === todayStr();
            const freq = FREQUENCY_SHORT[r.frequency] || r.frequency || "";
            const turnoLabel = r.slot.startTime + "–" + r.slot.endTime +
                (freq ? ' <span class="muted">(' + escapeHtml(freq) + ")</span>" : "");
            return "<tr><td class='col-num'>" + (idx + 1) + "</td>" +
                "<td>" + turnoLabel + "</td><td>" + r.date + "</td>" +
                "<td>" + escapeHtml(r.userFirstName || "—") + "</td>" +
                "<td>" + escapeHtml(r.userLastName || "—") + "</td>" +
                "<td>" + escapeHtml(r.userPhone) + "</td>" +
                "<td><span class='status-pill status-" + r.status + "'>" + statusLabel(r.status) + "</span></td>" +
                "<td>" + (showBtn ? "<button class='mini-btn' data-checkin='" + (r.reservationId || r.id) + "'>Asistió</button>" : "") + "</td></tr>";
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

    function shiftScopeAnchor(state, delta) {
        const anchor = state.anchor;
        if (state.view === "month") {
            const parts = anchor.split("-").map(Number);
            const d = new Date(parts[0], parts[1] - 1 + delta, 1);
            state.anchor = d.getFullYear() + "-" +
                String(d.getMonth() + 1).padStart(2, "0") + "-01";
        } else {
            const parts = anchor.split("-").map(Number);
            const d = new Date(parts[0], parts[1] - 1, parts[2] + delta * 7);
            state.anchor = d.getFullYear() + "-" +
                String(d.getMonth() + 1).padStart(2, "0") + "-" +
                String(d.getDate()).padStart(2, "0");
        }
    }

    function applyResQuick(quick) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const d = now.getDate();
        const pad = function (n) { return String(n).padStart(2, "0"); };

        if (quick === "this-week") {
            resScopeState.view = "week";
            resScopeState.anchor = y + "-" + pad(m + 1) + "-" + pad(d);
        } else if (quick === "next-week") {
            resScopeState.view = "week";
            const next = new Date(y, m, d + 7);
            resScopeState.anchor = next.getFullYear() + "-" + pad(next.getMonth() + 1) + "-" + pad(next.getDate());
        } else if (quick === "this-month") {
            resScopeState.view = "month";
            resScopeState.anchor = y + "-" + pad(m + 1) + "-01";
        }
        document.querySelectorAll(".res-view-btn").forEach(function (btn) {
            btn.classList.toggle("active", btn.getAttribute("data-res-view") === resScopeState.view);
        });
        loadReservations();
    }

    async function loadReservations() {
        if (!hasPerm("RESERVATIONS_VIEW")) return;
        const qs = new URLSearchParams({
            view: resScopeState.view,
            start: resScopeState.anchor,
        });
        const res = await api("/api/admin/reservations?" + qs.toString());
        const data = await res.json();
        if (!res.ok) {
            toast(data.error || "Error al cargar reservas.", "error");
            return;
        }
        reservationsCache = data.reservations || [];
        const label = document.getElementById("resRangeLabel");
        if (label) label.textContent = data.scope?.label || "—";
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

    // ── CALENDARIO DE GUARDIAS ──
    function shiftCalendarAnchor(delta) {
        shiftScopeAnchor(calendarState, delta);
    }

    function applyCalendarQuick(quick) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const d = now.getDate();
        const pad = function (n) { return String(n).padStart(2, "0"); };

        if (quick === "this-week") {
            calendarState.view = "week";
            calendarState.anchor = y + "-" + pad(m + 1) + "-" + pad(d);
        } else if (quick === "next-week") {
            calendarState.view = "week";
            const next = new Date(y, m, d + 7);
            calendarState.anchor = next.getFullYear() + "-" + pad(next.getMonth() + 1) + "-" + pad(next.getDate());
        } else if (quick === "this-month") {
            calendarState.view = "month";
            calendarState.anchor = y + "-" + pad(m + 1) + "-01";
        }
        document.querySelectorAll(".calendar-view-btn").forEach(function (btn) {
            btn.classList.toggle("active", btn.getAttribute("data-cal-view") === calendarState.view);
        });
        loadCalendar();
    }

    function renderCalendarGrid(data) {
        const wrap = document.getElementById("calendarWrap");
        const label = document.getElementById("calRangeLabel");
        const needsBadge = document.getElementById("calNeedsBadge");
        if (!wrap) return;

        if (label) label.textContent = data.label || "—";
        calendarCache = data;

        if (!data.days?.length) {
            wrap.innerHTML = '<div class="empty-state">Sin datos para este período.</div>';
            if (needsBadge) needsBadge.textContent = "0 huecos";
            return;
        }

        const slotTimes = [];
        const slotMap = {};
        data.days.forEach(function (day) {
            (day.slots || []).forEach(function (s) {
                const key = s.startTime + "–" + s.endTime;
                if (!slotMap[key]) {
                    slotMap[key] = true;
                    slotTimes.push({ start: s.startTime, end: s.endTime, key: key });
                }
            });
        });
        slotTimes.sort(function (a, b) { return a.start.localeCompare(b.start); });

        let needsCount = 0;
        data.days.forEach(function (day) {
            (day.slots || []).forEach(function (s) {
                if (s.needsMore > 0 || s.gapAlert) needsCount++;
            });
        });
        if (needsBadge) {
            needsBadge.textContent = needsCount + (needsCount === 1 ? " hueco" : " huecos");
        }

        const isMonth = data.view === "month";
        let html = '<div class="calendar-grid' + (isMonth ? " calendar-grid--month" : "") + '">';
        html += '<table class="calendar-table"><thead><tr><th class="cal-time-col">Hora</th>';
        data.days.forEach(function (day) {
            html += '<th class="cal-day-col"><span class="cal-day-name">' + escapeHtml(day.label) + "</span></th>";
        });
        html += "</tr></thead><tbody>";

        if (!slotTimes.length) {
            html += '<tr><td colspan="' + (data.days.length + 1) + '" class="muted">Sin turnos configurados.</td></tr>';
        } else {
            slotTimes.forEach(function (slot) {
                html += '<tr><td class="cal-time-col"><span class="cal-time">' + escapeHtml(slot.start) + "</span></td>";
                data.days.forEach(function (day) {
                    const block = (day.slots || []).find(function (s) {
                        return s.startTime === slot.start && s.endTime === slot.end;
                    });
                    let cellClass = "cal-cell";
                    if (block) {
                        if (block.gapAlert) cellClass += " cal-cell--gap";
                        else if (block.needsMore > 0) cellClass += " cal-cell--needs";
                        else if (block.taken > 0) cellClass += " cal-cell--filled";
                    }
                    html += '<td class="' + cellClass + '">';
                    if (block && block.commitments?.length) {
                        block.commitments.forEach(function (c) {
                            const name = [c.userFirstName, c.userLastName].filter(Boolean).join(" ") || c.userName;
                            html += '<div class="cal-person"><span class="cal-person-name">' + escapeHtml(name) + "</span>";
                            html += '<span class="cal-person-phone">' + escapeHtml(c.userPhone) + "</span></div>";
                        });
                    }
                    if (block && block.needsMore > 0) {
                        html += '<span class="cal-needs-pill">se necesita ' + block.needsMore + "</span>";
                    }
                    html += "</td>";
                });
                html += "</tr>";
            });
        }
        html += "</tbody></table></div>";
        wrap.innerHTML = html;
    }

    async function loadCalendar() {
        if (!hasPerm("SLOTS_VIEW")) return;
        const wrap = document.getElementById("calendarWrap");
        if (wrap) wrap.innerHTML = '<div class="empty-state">Cargando calendario…</div>';
        const qs = new URLSearchParams({
            view: calendarState.view,
            start: calendarState.anchor,
        });
        try {
            const res = await api("/api/admin/calendar?" + qs.toString());
            const data = await res.json();
            if (!res.ok) {
                toast(data.error || "Error al cargar calendario.", "error");
                if (wrap) wrap.innerHTML = '<div class="empty-state">No se pudo cargar el calendario.</div>';
                return;
            }
            renderCalendarGrid(data);
        } catch (e) {
            if (wrap) wrap.innerHTML = '<div class="empty-state">Error de conexión.</div>';
        }
    }

    function setupTurnosSubtabs() {
        document.querySelectorAll("#turnosSubtabs .subtab").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const view = btn.getAttribute("data-turnos-view");
                document.querySelectorAll("#turnosSubtabs .subtab").forEach(function (b) { b.classList.remove("active"); });
                document.querySelectorAll(".turnos-view").forEach(function (v) { v.classList.remove("active"); });
                btn.classList.add("active");
                const panel = document.getElementById("turnos-" + view);
                if (panel) panel.classList.add("active");
                if (view === "calendario") loadCalendar();
                else if (view === "lista") loadRoster();
                else if (view === "directorio") loadAdoradores();
                else if (view === "config") { loadSettingsForm(); loadSlots(); }
            });
        });
    }

    // ── DIRECTORIO DE ADORADORES ──
    function initDirectorioTable() {
        const table = document.getElementById("dirTable");
        if (!table || table.dataset.inited) return;
        table.dataset.inited = "1";
        table.innerHTML =
            "<thead><tr>" +
            "<th>#</th><th>Nombre</th><th>Apellido</th><th>Celular</th><th>Días</th><th>Turnos</th>" +
            "</tr><tr class='filter-row'>" +
            "<th></th>" +
            "<th><input type='text' class='col-filter' data-filter='firstName' placeholder='Buscar…'></th>" +
            "<th><input type='text' class='col-filter' data-filter='lastName' placeholder='Buscar…'></th>" +
            "<th><input type='text' class='col-filter' data-filter='phone' placeholder='Buscar…'></th>" +
            "<th><select class='col-filter' data-filter='weekday'>" +
            "<option value=''>Todos</option>" +
            "<option value='1'>Lunes</option><option value='2'>Martes</option>" +
            "<option value='3'>Miércoles</option><option value='4'>Jueves</option>" +
            "<option value='5'>Viernes</option><option value='6'>Sábado</option>" +
            "<option value='7'>Domingo</option>" +
            "</select></th>" +
            "<th></th>" +
            "</tr></thead><tbody id='dirTableBody'></tbody>";

        table.querySelectorAll(".col-filter").forEach(function (input) {
            input.addEventListener("input", onDirFilterChange);
            input.addEventListener("change", onDirFilterChange);
        });
    }

    function filterAdoradores(list) {
        return list.filter(function (a) {
            if (dirColFilters.firstName &&
                !(a.firstName || "").toLowerCase().includes(dirColFilters.firstName.toLowerCase())) return false;
            if (dirColFilters.lastName &&
                !(a.lastName || "").toLowerCase().includes(dirColFilters.lastName.toLowerCase())) return false;
            if (dirColFilters.phone && !(a.phone || "").includes(dirColFilters.phone)) return false;
            if (dirColFilters.weekday) {
                const wd = Number(dirColFilters.weekday);
                if (!a.weekdays || !a.weekdays.includes(wd)) return false;
            }
            return true;
        });
    }

    function renderDirectorioTable() {
        initDirectorioTable();
        const filtered = filterAdoradores(adoradoresCache);
        const tbody = document.getElementById("dirTableBody");
        const badge = document.getElementById("dirCountBadge");

        if (badge) {
            badge.textContent = filtered.length + (filtered.length === 1 ? " adorador" : " adoradores");
        }

        tbody.innerHTML = filtered.length ? filtered.map(function (a, idx) {
            return "<tr><td class='col-num'>" + (idx + 1) + "</td>" +
                "<td>" + escapeHtml(a.firstName || "—") + "</td>" +
                "<td>" + escapeHtml(a.lastName || "—") + "</td>" +
                "<td>" + escapeHtml(a.phone) + "</td>" +
                "<td>" + escapeHtml(a.weekdaysLabel || "—") + "</td>" +
                "<td class='dir-slots'>" + escapeHtml((a.slots || []).join(", ") || "—") + "</td></tr>";
        }).join("") : "<tr><td colspan='6' class='muted'>Sin adoradores con estos filtros.</td></tr>";
    }

    function onDirFilterChange(e) {
        const key = e.target.getAttribute("data-filter");
        if (!key) return;
        dirColFilters[key] = e.target.value;
        renderDirectorioTable();
    }

    function clearDirFilters() {
        Object.keys(dirColFilters).forEach(function (k) { dirColFilters[k] = ""; });
        document.querySelectorAll("#dirTable .col-filter").forEach(function (el) { el.value = ""; });
        renderDirectorioTable();
    }

    async function loadAdoradores() {
        if (!hasPerm("SLOTS_VIEW")) return;
        try {
            const res = await api("/api/admin/adoradores");
            const data = await res.json();
            if (!res.ok) {
                toast(data.error || "Error al cargar directorio.", "error");
                return;
            }
            adoradoresCache = data.adoradores || [];
            renderDirectorioTable();
        } catch (e) {
            toast("Error de conexión.", "error");
        }
    }

    // ── LISTA / ROSTER ──
    function formatRosterDisplayTime(hhmm) {
        const parts = hhmm.split(":");
        return Number(parts[0]) + ":" + parts[1];
    }

    function populateRosterTimeFilter(slotTimes) {
        const sel = document.getElementById("rosterTimeFilter");
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">Todas</option>' +
            (slotTimes || []).map(function (t) {
                return '<option value="' + t + '">' + formatRosterDisplayTime(t) + "</option>";
            }).join("");
        if (current && slotTimes && slotTimes.includes(current)) sel.value = current;
    }

    function populateRosterMemberTimeGrid(slotTimes, selected) {
        const grid = document.getElementById("rosterMemberTimes");
        if (!grid) return;
        const selectedSet = new Set(selected || []);
        grid.innerHTML = (slotTimes || []).map(function (t) {
            const checked = selectedSet.has(t) ? " checked" : "";
            return '<label class="admin-check roster-time-check">' +
                '<input type="checkbox" value="' + t + '"' + checked + ">" +
                "<span>" + formatRosterDisplayTime(t) + "</span></label>";
        }).join("");
    }

    function updateRosterSectionVisibility() {
        const showC = document.getElementById("rosterShowCommitments")?.checked;
        const showCap = document.getElementById("rosterShowCaptains")?.checked;
        const showSub = document.getElementById("rosterShowSubstitutes")?.checked;
        const secC = document.getElementById("rosterCommitmentsSection");
        const secCap = document.getElementById("rosterCaptainsSection");
        const secSub = document.getElementById("rosterSubstitutesSection");
        if (secC) secC.style.display = showC ? "" : "none";
        if (secCap) secCap.style.display = showCap ? "" : "none";
        if (secSub) secSub.style.display = showSub ? "" : "none";
    }

    function renderRosterTables() {
        const canEdit = hasPerm("SLOTS_EDIT");
        const commitments = rosterCache.commitments || [];
        const captains = rosterCache.captains || [];
        const substitutes = rosterCache.substitutes || [];

        document.getElementById("rosterCommitmentsCount").textContent = commitments.length;
        document.getElementById("rosterCaptainsCount").textContent = captains.length;
        document.getElementById("rosterSubstitutesCount").textContent = substitutes.length;

        const cTable = document.getElementById("rosterCommitmentsTable");
        cTable.innerHTML =
            "<thead><tr><th>Turno</th><th>Duración</th><th>Frecuencia</th><th>Propietario</th><th>Teléfono</th><th>Notas</th></tr></thead><tbody>" +
            (commitments.length ? commitments.map(function (c) {
                const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "—";
                return "<tr><td>" + escapeHtml(c.turno) + "</td>" +
                    "<td>" + escapeHtml(c.durationLabel) + "</td>" +
                    "<td>" + escapeHtml(c.frequencyLabel) + "</td>" +
                    "<td>" + escapeHtml(name) + "</td>" +
                    "<td>" + escapeHtml(c.phone) + "</td>" +
                    "<td class='muted'>" + escapeHtml(c.internalNotes || "—") + "</td></tr>";
            }).join("") : "<tr><td colspan='6' class='muted'>Sin compromisos con estos filtros.</td></tr>") +
            "</tbody>";

        function memberRows(list, role) {
            return list.length ? list.map(function (m) {
                const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || "—";
                const scope = (m.daysLabel !== "Todos" || m.timesLabel !== "Todos")
                    ? '<span class="muted roster-scope">' + escapeHtml(m.daysLabel) + " · " + escapeHtml(m.timesLabel) + "</span>"
                    : '<span class="muted roster-scope">Todos los días y horas</span>';
                const editBtn = canEdit
                    ? "<div class='admin-actions'>" +
                    "<button class='mini-btn' data-edit-roster='" + m.id + "'>Editar</button>" +
                    "<button class='mini-btn danger' data-delete-roster='" + m.id + "'>Eliminar</button></div>"
                    : "";
                return "<tr><td>" + escapeHtml(name) + scope + "</td>" +
                    "<td>" + escapeHtml(m.phone) + "</td>" +
                    "<td>" + escapeHtml(m.email || "—") + "</td>" +
                    "<td>" + escapeHtml(m.internalNotes || "—") + "</td>" +
                    "<td>" + editBtn + "</td></tr>";
            }).join("") : "<tr><td colspan='5' class='muted'>Sin registros con estos filtros.</td></tr>";
        }

        const capTable = document.getElementById("rosterCaptainsTable");
        capTable.innerHTML =
            "<thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Notas internas</th><th></th></tr></thead><tbody>" +
            memberRows(captains, "captain") + "</tbody>";

        const subTable = document.getElementById("rosterSubstitutesTable");
        subTable.innerHTML =
            "<thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Notas internas</th><th></th></tr></thead><tbody>" +
            memberRows(substitutes, "substitute") + "</tbody>";

        document.querySelectorAll("[data-edit-roster]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                openRosterMemberEditor(Number(btn.getAttribute("data-edit-roster")));
            });
        });
        document.querySelectorAll("[data-delete-roster]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                deleteRosterMember(Number(btn.getAttribute("data-delete-roster")));
            });
        });

        updateRosterSectionVisibility();
    }

    function rosterPhonesFromSection(section) {
        if (section === "commitments") {
            return [...new Set((rosterCache.commitments || []).map(function (c) { return c.phone; }).filter(Boolean))];
        }
        const list = section === "captains" ? rosterCache.captains : rosterCache.substitutes;
        return [...new Set((list || []).map(function (m) { return m.phone; }).filter(Boolean))];
    }

    function copyRosterPhones(section) {
        const phones = rosterPhonesFromSection(section);
        if (!phones.length) return toast("No hay teléfonos en esta sección.", "error");
        const text = phones.join(", ");
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                toast(phones.length + " teléfono" + (phones.length === 1 ? "" : "s") + " copiado" + (phones.length === 1 ? "" : "s") + ".", "success");
            }).catch(function () {
                toast(text, "info");
            });
        } else {
            toast(text, "info");
        }
    }

    async function loadRoster() {
        if (!hasPerm("SLOTS_VIEW")) return;
        const weekday = document.getElementById("rosterDayFilter").value;
        const slotTime = document.getElementById("rosterTimeFilter").value;
        const qs = new URLSearchParams();
        if (weekday) qs.set("weekday", weekday);
        if (slotTime) qs.set("slotTime", slotTime);
        try {
            const res = await api("/api/admin/roster?" + qs.toString());
            const data = await res.json();
            if (!res.ok) {
                toast(data.error || "Error al cargar la lista.", "error");
                return;
            }
            rosterCache = data;
            populateRosterTimeFilter(data.slotTimes || []);
            populateRosterMemberTimeGrid(data.slotTimes || [], []);
            renderRosterTables();
        } catch (e) {
            toast("Error de conexión.", "error");
        }
    }

    function openRosterMemberSheet(role, member) {
        const isCaptain = role === "captain";
        document.getElementById("rosterMemberSheetTitle").textContent = isCaptain ? "Capitán" : "Sustituto";
        document.getElementById("rosterMemberRole").value = role;
        document.getElementById("rosterMemberId").value = member ? member.id : "";
        const delBtn = document.getElementById("deleteRosterMemberBtn");
        if (delBtn) {
            delBtn.style.display = member && hasPerm("SLOTS_EDIT") ? "" : "none";
            delBtn.dataset.memberId = member ? String(member.id) : "";
        }
        document.getElementById("rosterMemberFirst").value = member ? member.firstName : "";
        document.getElementById("rosterMemberLast").value = member ? member.lastName : "";
        document.getElementById("rosterMemberPhone").value = member ? member.phone : "";
        document.getElementById("rosterMemberEmail").value = member ? (member.email || "") : "";
        document.getElementById("rosterMemberNotes").value = member ? (member.internalNotes || "") : "";

        const selectedDays = member && member.weekDays ? member.weekDays.split(",") : [];
        document.querySelectorAll("#rosterMemberDays input[type='checkbox']").forEach(function (cb) {
            cb.checked = selectedDays.includes(cb.value);
        });

        const selectedTimes = member && member.slotTimes ? member.slotTimes.split(",") : [];
        populateRosterMemberTimeGrid(rosterCache.slotTimes || [], selectedTimes);

        document.getElementById("rosterMemberSheet").classList.add("active");
    }

    function openRosterMemberEditor(id) {
        const member = (rosterCache.captains || []).concat(rosterCache.substitutes || [])
            .find(function (m) { return m.id === id; });
        if (!member) return;
        openRosterMemberSheet(member.role, member);
    }

    function readRosterMemberForm() {
        const days = [];
        document.querySelectorAll("#rosterMemberDays input:checked").forEach(function (cb) {
            days.push(cb.value);
        });
        const times = [];
        document.querySelectorAll("#rosterMemberTimes input:checked").forEach(function (cb) {
            times.push(cb.value);
        });
        return {
            role: document.getElementById("rosterMemberRole").value,
            firstName: document.getElementById("rosterMemberFirst").value.trim(),
            lastName: document.getElementById("rosterMemberLast").value.trim(),
            phone: document.getElementById("rosterMemberPhone").value.trim(),
            email: document.getElementById("rosterMemberEmail").value.trim(),
            internalNotes: document.getElementById("rosterMemberNotes").value.trim(),
            weekDays: days.length ? days.join(",") : null,
            slotTimes: times.length ? times.join(",") : null,
        };
    }

    async function saveRosterMember() {
        if (!hasPerm("SLOTS_EDIT")) return;
        const id = document.getElementById("rosterMemberId").value;
        const body = readRosterMemberForm();
        if (!body.firstName || !body.phone) {
            return toast("Nombre y celular son requeridos.", "error");
        }
        if (!/^\d{8}$/.test(body.phone)) {
            return toast("El celular debe tener exactamente 8 dígitos.", "error");
        }
        const btn = document.getElementById("saveRosterMemberBtn");
        btn.disabled = true;
        try {
            const res = id
                ? await api("/api/admin/roster-members/" + id, { method: "PUT", body: JSON.stringify(body) })
                : await api("/api/admin/roster-members", { method: "POST", body: JSON.stringify(body) });
            const data = await res.json();
            if (res.ok) {
                toast(id ? "Registro actualizado." : "Registro creado.", "success");
                document.getElementById("rosterMemberSheet").classList.remove("active");
                loadRoster();
            } else {
                toast(data.error || "Error al guardar.", "error");
            }
        } finally {
            btn.disabled = false;
        }
    }

    async function deleteRosterMember(id) {
        if (!hasPerm("SLOTS_EDIT")) return;
        if (!confirm("¿Eliminar este registro de la lista?")) return;
        const res = await api("/api/admin/roster-members/" + id, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) {
            toast("Registro eliminado.", "success");
            loadRoster();
        } else {
            toast(data.error || "Error al eliminar.", "error");
        }
    }

    async function exportRosterSection(section) {
        const weekday = document.getElementById("rosterDayFilter").value;
        const slotTime = document.getElementById("rosterTimeFilter").value;
        const qs = new URLSearchParams({ section: section });
        if (weekday) qs.set("weekday", weekday);
        if (slotTime) qs.set("slotTime", slotTime);
        try {
            const res = await api("/api/admin/roster/export.csv?" + qs.toString());
            if (!res.ok) {
                const data = await res.json().catch(function () { return {}; });
                return toast(data.error || "No se pudo exportar.", "error");
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "lista-" + section + ".csv";
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            toast("No se pudo exportar.", "error");
        }
    }

    async function loadChapelQr() {
        if (!hasPerm("QRS_VIEW")) return;
        const preview = document.getElementById("chapelQrPreview");
        const usesEl = document.getElementById("chapelQrUses");
        try {
            const res = await api("/api/admin/qrs/chapel");
            const data = await res.json();
            if (!res.ok || !data.chapel) {
                if (preview) preview.innerHTML = '<div class="empty-state">' + escapeHtml(data.error || "No se pudo cargar el QR.") + "</div>";
                return;
            }
            const c = data.chapel;
            if (usesEl) usesEl.textContent = c.uses + (c.uses === 1 ? " escaneo" : " escaneos");
            if (preview) {
                preview.innerHTML =
                    '<img src="' + data.image + '" alt="QR de la capilla" class="chapel-qr-image">' +
                    '<code class="chapel-qr-code">' + escapeHtml(c.qrCode) + "</code>" +
                    '<p class="muted chapel-qr-url">' + escapeHtml(c.scanUrl) + "</p>";
            }
        } catch (e) {
            if (preview) preview.innerHTML = '<div class="empty-state">Error de conexión.</div>';
        }
    }

    async function loadQrs() {
        if (!hasPerm("QRS_VIEW")) return;
        await loadChapelQr();
        const res = await api("/api/admin/qrs");
        const data = await res.json();
        const canEdit = hasPerm("QRS_EDIT");
        const history = (data.qrs || []).filter(function (q) { return !q.isChapelTotem; });
        const table = document.getElementById("qrTable");
        table.innerHTML =
            "<thead><tr><th>Código</th><th>Nombre</th><th>Ubicación</th><th>Estado</th><th>Usos</th><th></th></tr></thead><tbody>" +
            (history.length ? history.map(function (q) {
                let btns = "<a class='mini-btn' href='/api/admin/qrs/" + q.id + "/png' target='_blank' rel='noopener'>PNG</a>";
                if (canEdit && !q.isChapelTotem) {
                    btns += "<button class='mini-btn' data-toggleqr='" + q.id + "' data-active='" + q.isActive + "'>" +
                        (q.isActive ? "Desactivar" : "Activar") + "</button>";
                }
                return "<tr><td><code>" + q.qrCode + "</code></td><td>" + escapeHtml(q.displayName) + "</td>" +
                    "<td>" + escapeHtml(q.location || "—") + "</td>" +
                    "<td><span class='status-pill " + (q.isActive ? "status-completed" : "status-cancelled") + "'>" +
                    (q.isActive ? "Activo" : "Inactivo") + "</span></td><td>" + q.uses + "</td><td>" + btns + "</td></tr>";
            }).join("") : "<tr><td colspan='6' class='muted'>Sin códigos anteriores.</td></tr>") + "</tbody>";
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

    async function downloadPng(path, filename) {
        try {
            const res = await api(path);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename || path.split("/").slice(-2)[0] + ".png";
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { toast("No se pudo descargar.", "error"); }
    }

    async function printChapelQr() {
        await downloadPng("/api/admin/qrs/chapel/png", "qr-capilla.png");
    }

    async function replaceChapelQr() {
        if (!hasPerm("QRS_CREATE")) return;
        if (!confirm("¿Generar un nuevo QR de capilla? El código actual dejará de funcionar y deberás imprimir el nuevo.")) return;
        const res = await api("/api/admin/qrs/chapel/replace", { method: "POST" });
        const data = await res.json();
        if (res.ok) {
            toast(data.message || "Nuevo QR de capilla generado.", "success");
            loadQrs();
            loadActivity();
        } else {
            toast(data.error || "No se pudo generar.", "error");
        }
    }

    async function toggleQr(id, isActive) {
        const res = await api("/api/admin/qrs/" + id, { method: "PUT", body: JSON.stringify({ isActive }) });
        if (res.ok) loadQrs();
        else { const d = await res.json(); toast(d.error || "Error.", "error"); }
    }

    async function exportCsv() {
        const qs = new URLSearchParams({
            view: resScopeState.view,
            start: resScopeState.anchor,
        });
        if (resColFilters.firstName) qs.set("firstName", resColFilters.firstName);
        if (resColFilters.lastName) qs.set("lastName", resColFilters.lastName);
        if (resColFilters.phone) qs.set("phone", resColFilters.phone);
        if (resColFilters.status) qs.set("status", resColFilters.status);
        if (resColFilters.slot) qs.set("slotTime", resColFilters.slot);
        const path = "/api/admin/reports/reservations.csv?" + qs.toString();
        try {
            const res = await api(path);
            if (!res.ok) {
                const data = await res.json().catch(function () { return {}; });
                return toast(data.error || "No se pudo exportar.", "error");
            }
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
                const disabled = readonly ? " disabled" : "";
                html += '<div class="permission-row"><span class="permission-label">' + escapeHtml(node.label) + '</span>' +
                    '<label class="perm-toggle" for="' + id + '">' +
                    '<input type="checkbox" id="' + id + '" data-bit="' + node.bit + '"' +
                    (checked ? " checked" : "") + disabled + '>' +
                    '<span class="perm-toggle-track" aria-hidden="true"></span></label></div>';
            });
            html += "</div>";
        });
        return html;
    }

    function closeRoleSheet() {
        const sheet = document.getElementById("roleSheet");
        if (!sheet) return;
        sheet.classList.remove("active");
        sheet.setAttribute("aria-hidden", "true");
        document.body.classList.remove("sheet-open");
    }

    function openRoleSheet() {
        const sheet = document.getElementById("roleSheet");
        if (!sheet) return;
        sheet.classList.add("active");
        sheet.setAttribute("aria-hidden", "false");
        document.body.classList.add("sheet-open");
        hideOnboardHint(true);
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
        const isLocked = role.slug === "super-admin";
        const readonly = !canManage || isLocked;
        const otherRoles = rolesCache.filter(function (r) { return r.id !== role.id && r.slug !== "super-admin"; });
        const reassignHtml = role.userCount > 0 && otherRoles.length
            ? '<div class="role-delete-reassign"><p class="muted" style="font-size:0.82rem;margin:0 0 8px;">' +
                role.userCount + " administrador(es) usan este perfil. Elige a dónde reasignarlos:</p>" +
                '<select id="reassignRoleSelect" class="touch-input-field">' +
                otherRoles.map(function (r) {
                    return "<option value='" + r.id + "'>" + escapeHtml(r.name) + "</option>";
                }).join("") +
                "</select></div>"
            : (role.userCount > 0 ? '<p class="muted" style="font-size:0.82rem;">Hay administradores con este perfil. Crea otro perfil antes de eliminar.</p>' : "");

        editor.innerHTML =
            '<h3 style="margin:0 0 4px;font-family:var(--admin-serif);font-size:1.4rem;">' + escapeHtml(role.name) + '</h3>' +
            '<p class="muted" style="margin:0 0 20px;font-size:0.86rem;">' + escapeHtml(role.description || "") + '</p>' +
            buildPermissionMatrixHTML(session.permissionNodes, role.privileges, "edit-", readonly) +
            (canManage && !isLocked ? '<div class="role-editor-actions">' +
                reassignHtml +
                '<button class="sheet-primary-btn" id="saveRoleEditorBtn">Guardar permisos</button>' +
                '<button class="sheet-primary-btn danger-outline" id="deleteRoleBtn">Eliminar perfil</button>' +
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
        if (!role || role.slug === "super-admin") return;
        const otherRoles = rolesCache.filter(function (r) { return r.id !== id && r.slug !== "super-admin"; });
        if (role.userCount > 0 && !otherRoles.length) {
            return toast("Hay administradores con este perfil. Crea otro perfil antes de eliminar.", "error");
        }
        const msg = role.userCount > 0
            ? "¿Eliminar el perfil «" + role.name + "» y reasignar " + role.userCount + " administrador(es)?"
            : "¿Eliminar el perfil «" + role.name + "»?";
        if (!confirm(msg)) return;
        const body = {};
        if (role.userCount > 0) {
            const sel = document.getElementById("reassignRoleSelect");
            if (!sel) return toast("Selecciona un perfil de reasignación.", "error");
            body.reassignToRoleId = Number(sel.value);
        }
        const res = await api("/api/admin/roles/" + id, { method: "DELETE", body: JSON.stringify(body) });
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
        openRoleSheet();
        const body = document.querySelector("#roleSheet .sheet-form-body");
        if (body) body.scrollTop = 0;
        window.requestAnimationFrame(function () {
            document.getElementById("roleName").focus();
        });
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
            closeRoleSheet();
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
    async function resetDemoData() {
        if (!session.user?.isSuperAdmin) {
            return toast("Solo Super Admin puede resetear datos de demostración.", "error");
        }
        const confirm = document.getElementById("demoResetConfirm").value.trim();
        if (confirm !== "BORRAR") {
            return toast('Escribe BORRAR en el campo de confirmación.', "error");
        }
        if (!window.confirm("¿Resetear todos los datos operativos y cargar la demostración?")) return;

        const btn = document.getElementById("demoResetBtn");
        btn.disabled = true;
        try {
            const res = await api("/api/admin/demo/reset", {
                method: "POST",
                body: JSON.stringify({ confirm: "BORRAR" }),
            });
            const data = await res.json();
            if (res.ok) {
                toast(data.message || "Datos de demostración cargados.", "success");
                document.getElementById("demoResetConfirm").value = "";
                auditOffset = 0;
                loadAudit();
                loadMetrics();
                loadActivity();
            } else {
                toast(data.error || "Error al resetear.", "error");
            }
        } catch (e) {
            toast("Error de conexión.", "error");
        } finally {
            btn.disabled = false;
        }
    }

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
                    : l.action.indexOf("delete") >= 0 || l.action.indexOf("demo") >= 0 ? "security" : "";
                const detail = l.target ? "→ " + escapeHtml(l.target.name) : (l.meta ? escapeHtml(JSON.stringify(l.meta)) : "—");
                return "<tr><td>" + formatTime(l.createdAt) + "</td>" +
                    "<td><span class='audit-action " + actionClass + "'>" + escapeHtml(actionLabel(l.action)) + "</span></td>" +
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
                    turnos: function () {
                        const activeSub = document.querySelector("#turnosSubtabs .subtab.active");
                        const view = activeSub ? activeSub.getAttribute("data-turnos-view") : "calendario";
                        if (view === "lista") loadRoster();
                        else if (view === "directorio") loadAdoradores();
                        else if (view === "config") { loadSettingsForm(); loadSlots(); }
                        else loadCalendar();
                    },
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
    document.getElementById("metricDetailClose").addEventListener("click", closeMetricDetail);

    document.getElementById("loginBtn").addEventListener("click", login);
    document.getElementById("loginPass").addEventListener("keydown", function (e) { if (e.key === "Enter") login(); });
    document.getElementById("logoutBtn").addEventListener("click", logout);
    document.getElementById("resClearFilters").addEventListener("click", clearResFilters);
    document.getElementById("resPrev").addEventListener("click", function () {
        shiftScopeAnchor(resScopeState, -1);
        loadReservations();
    });
    document.getElementById("resNext").addEventListener("click", function () {
        shiftScopeAnchor(resScopeState, 1);
        loadReservations();
    });
    document.querySelectorAll(".res-view-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            resScopeState.view = btn.getAttribute("data-res-view");
            document.querySelectorAll(".res-view-btn").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            loadReservations();
        });
    });
    document.querySelectorAll(".res-quick").forEach(function (btn) {
        btn.addEventListener("click", function () {
            applyResQuick(btn.getAttribute("data-res-quick"));
        });
    });
    document.getElementById("muroStatusFilter").addEventListener("change", loadIntentions);
    document.getElementById("exportCsv").addEventListener("click", exportCsv);
    document.getElementById("addSlot").addEventListener("click", addSlot);
    document.getElementById("saveSettingsBtn").addEventListener("click", saveSettingsForm);
    document.getElementById("saveSlotBtn").addEventListener("click", saveSlot);
    document.getElementById("calPrev").addEventListener("click", function () {
        shiftCalendarAnchor(-1);
        loadCalendar();
    });
    document.getElementById("calNext").addEventListener("click", function () {
        shiftCalendarAnchor(1);
        loadCalendar();
    });
    document.querySelectorAll(".calendar-view-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            calendarState.view = btn.getAttribute("data-cal-view");
            document.querySelectorAll(".calendar-view-btn").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            loadCalendar();
        });
    });
    document.querySelectorAll(".cal-quick").forEach(function (btn) {
        btn.addEventListener("click", function () {
            applyCalendarQuick(btn.getAttribute("data-cal-quick"));
        });
    });
    document.getElementById("dirClearFilters").addEventListener("click", clearDirFilters);
    document.getElementById("rosterDayFilter").addEventListener("change", loadRoster);
    document.getElementById("rosterTimeFilter").addEventListener("change", loadRoster);
    ["rosterShowCommitments", "rosterShowCaptains", "rosterShowSubstitutes"].forEach(function (id) {
        document.getElementById(id).addEventListener("change", updateRosterSectionVisibility);
    });
    document.getElementById("newCaptainBtn").addEventListener("click", function () {
        openRosterMemberSheet("captain", null);
    });
    document.getElementById("newSubstituteBtn").addEventListener("click", function () {
        openRosterMemberSheet("substitute", null);
    });
    document.getElementById("saveRosterMemberBtn").addEventListener("click", saveRosterMember);
    document.getElementById("deleteRosterMemberBtn").addEventListener("click", function () {
        const id = Number(document.getElementById("deleteRosterMemberBtn").dataset.memberId);
        if (id) deleteRosterMember(id);
    });
    document.querySelectorAll(".roster-export").forEach(function (btn) {
        btn.addEventListener("click", function () {
            exportRosterSection(btn.getAttribute("data-export"));
        });
    });
    document.querySelectorAll(".roster-message").forEach(function (btn) {
        btn.addEventListener("click", function () {
            copyRosterPhones(btn.getAttribute("data-message"));
        });
    });
    document.getElementById("printChapelQrBtn").addEventListener("click", printChapelQr);
    document.getElementById("replaceChapelQrBtn").addEventListener("click", replaceChapelQr);
    document.getElementById("newRoleBtn").addEventListener("click", openNewRoleSheet);
    document.getElementById("saveRoleBtn").addEventListener("click", saveNewRole);
    document.getElementById("newAdminBtn").addEventListener("click", openAdminSheet);
    document.getElementById("createAdminBtn").addEventListener("click", createAdmin);
    document.getElementById("auditRefresh").addEventListener("click", function () { auditOffset = 0; loadAudit(); });
    document.getElementById("demoResetBtn").addEventListener("click", resetDemoData);
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
        b.addEventListener("click", function () {
            const overlay = b.closest(".premium-sheet-overlay");
            if (!overlay) return;
            overlay.classList.remove("active");
            overlay.setAttribute("aria-hidden", "true");
            if (overlay.id === "roleSheet") document.body.classList.remove("sheet-open");
        });
    });

    document.getElementById("roleSheet").addEventListener("click", function (e) {
        if (e.target === document.getElementById("roleSheet")) closeRoleSheet();
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && document.getElementById("roleSheet").classList.contains("active")) {
            closeRoleSheet();
        }
    });

    setupTabs();
    setupTurnosSubtabs();
    setupOnboardingHints();

    if (token) showDashboard();
})();
