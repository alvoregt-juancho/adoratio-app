(function () {
    "use strict";

    function showToast(message, type) {
        let toast = document.querySelector(".toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.className = "toast";
            document.body.appendChild(toast);
        }
        toast.className = "toast " + (type || "");
        toast.textContent = message;
        void toast.offsetWidth;
        toast.classList.add("show");
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () {
            toast.classList.remove("show");
        }, 3600);
    }

    function normalizePhone(raw) {
        return (raw || "").replace(/\D/g, "");
    }

    function isValidPhone(phone) {
        return /^\d{8}$/.test(phone);
    }

    function getQrCode() {
        return new URLSearchParams(window.location.search).get("code");
    }

    async function executeCommitment() {
        const input = document.getElementById("userPhone");
        const button = document.getElementById("checkinBtn");
        const result = document.getElementById("result");
        if (!input) return;

        const userPhone = normalizePhone(input.value);
        const qrCode = getQrCode();

        if (!isValidPhone(userPhone)) {
            showToast("El celular debe tener exactamente 8 dígitos.", "error");
            input.focus();
            return;
        }
        if (!qrCode) {
            showToast("Falta el código del QR. Escanea el código de la entrada.", "error");
            return;
        }

        button.disabled = true;
        button.textContent = "REGISTRANDO…";
        if (result) result.className = "result-box";

        try {
            const res = await fetch("/api/check-in/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qrCode, userPhone }),
            });
            const data = await res.json();

            if (res.ok) {
                if (result) {
                    result.className = "result-box success show";
                    result.innerHTML =
                        "<strong>" + data.message + "</strong>" +
                        (data.details ? "<span>" + data.details.slot + " · " + data.details.checkedInAt + "</span>" : "");
                }
                button.textContent = "ASISTENCIA REGISTRADA";
            } else {
                if (result) {
                    result.className = "result-box error show";
                    result.textContent = data.error || "No se pudo registrar la asistencia.";
                }
                button.disabled = false;
                button.textContent = "CONFIRMAR ASISTENCIA";
            }
        } catch (e) {
            if (result) {
                result.className = "result-box error show";
                result.textContent = "Error de conexión. Intenta nuevamente.";
            }
            button.disabled = false;
            button.textContent = "CONFIRMAR ASISTENCIA";
        }
    }

    function initParallax() {
        const bg = document.querySelector(".cinematic-bg");
        if (!bg) return;
        let ticking = false;
        window.addEventListener("scroll", function () {
            if (ticking) return;
            ticking = true;
            window.requestAnimationFrame(function () {
                const offset = window.scrollY * 0.25;
                bg.style.transform = "scale(1.08) translateY(" + offset + "px)";
                ticking = false;
            });
        }, { passive: true });
    }

    document.addEventListener("DOMContentLoaded", function () {
        initParallax();

        const qrInfo = document.getElementById("qrInfo");
        const code = getQrCode();
        if (qrInfo && code) {
            qrInfo.textContent = "Punto de registro verificado. Confirma tu llegada.";
        } else if (qrInfo && !code && document.getElementById("userPhone")) {
            qrInfo.textContent = "Escanea el QR de la entrada de la capilla para registrarte.";
        }

        const input = document.getElementById("userPhone");
        if (input) {
            input.addEventListener("input", function () {
                const digits = normalizePhone(input.value).slice(0, 8);
                if (input.value !== digits) input.value = digits;
            });
            input.addEventListener("paste", function (e) {
                e.preventDefault();
                const pasted = normalizePhone((e.clipboardData || window.clipboardData).getData("text"));
                input.value = pasted.slice(0, 8);
            });
            input.addEventListener("keydown", function (e) {
                if (e.key === "Enter") executeCommitment();
            });
        }
    });

    window.executeCommitment = executeCommitment;
    window.AdoratioToast = showToast;
})();
