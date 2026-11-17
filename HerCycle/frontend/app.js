/* HerCycle browser client for the local Express/MySQL API. */
(() => {
    const tokenKey = "hercycleToken";
    const api = window.herCycleApi;
    const json = (method, body) => ({ method, body: JSON.stringify(body) });
    const setMessage = (element, text, isError = false) => {
        if (!element) return;
        element.textContent = text;
        element.style.color = isError ? "#b42318" : "#38834a";
    };
    const showPageError = (text) => {
        let status = byId("pageMessage");
        if (!status) {
            status = document.createElement("p");
            status.id = "pageMessage";
            status.setAttribute("role", "alert");
            const main = document.querySelector("main") || document.body;
            main.prepend(status);
        }
        setMessage(status, text, true);
    };
    const escapeText = (value) => String(value == null ? "" : value);
    const today = () => new Date().toLocaleDateString("en-CA");
    const byId = (id) => document.getElementById(id);

    document.addEventListener("DOMContentLoaded", async () => {
        document.querySelectorAll('a[href="index.html"]').forEach((link) => {
            if (link.textContent.trim().toLowerCase() === "logout") {
                link.addEventListener("click", () => {
                    localStorage.removeItem(tokenKey);
                    localStorage.removeItem("hercycleCurrentUser");
                });
            }
        });

        const page = window.location.pathname.split("/").pop();
        const privatePages = [
            "dashboard.html", "tracker.html", "symptoms.html", "mood.html",
            "reminder.html", "reports.html", "questions.html"
        ];
        let currentUser = null;
        if (privatePages.includes(page)) {
            if (!localStorage.getItem(tokenKey)) {
                window.location.replace("login.html");
                return;
            }
            try {
                const result = await api("/auth/me");
                currentUser = result.user;
                const welcome = byId("welcomeUser");
                if (welcome) welcome.textContent = currentUser.name;
            } catch (error) {
                showPageError(error.message);
                if (!localStorage.getItem(tokenKey)) window.location.replace("login.html");
                return;
            }
        }

        initAuth();
        if (page === "dashboard.html") await initDashboardAnalytics();
        if (page === "tracker.html") await initTracker();
        if (page === "symptoms.html") await initSymptoms();
        if (page === "mood.html") await initMood();
        if (page === "reminder.html") await initReminders();
        if (page === "reports.html") await initReports();
        if (page === "questions.html") await initQuestions();
        if (page === "awareness.html") await initAwareness();
    });

    async function initDashboardAnalytics() {
        const status = byId("analyticsStatus");
        const setStat = (id, value) => { byId(id).textContent = value; };
        const formatDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
            day: "numeric", month: "short", year: "numeric"
        });
        const renderBars = (containerId, entries, total, emptyMessage, scaleToTotal) => {
            const container = byId(containerId);
            container.replaceChildren();
            if (!entries.length) {
                const empty = document.createElement("p");
                empty.className = "analytics-empty";
                empty.textContent = emptyMessage;
                container.appendChild(empty);
                return;
            }
            const max = scaleToTotal ? total : Math.max(...entries.map((entry) => entry.count));
            entries.forEach((entry) => {
                const row = document.createElement("div");
                row.className = "analytics-bar-row";
                const label = document.createElement("span");
                label.className = "analytics-bar-label";
                label.textContent = entry.label;
                const track = document.createElement("span");
                track.className = "analytics-bar-track";
                track.setAttribute("role", "img");
                track.setAttribute("aria-label", `${entry.label}: ${entry.count}`);
                const fill = document.createElement("span");
                fill.className = "analytics-bar-fill";
                fill.style.display = "block";
                fill.style.width = `${Math.max(3, entry.count / max * 100)}%`;
                track.appendChild(fill);
                const value = document.createElement("strong");
                value.textContent = entry.count;
                row.append(label, track, value);
                container.appendChild(row);
            });
        };

        try {
            const [periodResult, symptomResult, moodResult] = await Promise.all([
                api("/periods"),
                api("/symptoms"),
                api("/moods")
            ]);
            const periods = periodResult.items.slice().sort((a, b) => a.start.localeCompare(b.start));
            const durations = periods.map((period) =>
                (Date.parse(`${period.end}T00:00:00`) - Date.parse(`${period.start}T00:00:00`)) / 86400000 + 1
            ).filter((days) => days > 0);
            const cycleLengths = periods.slice(1).map((period, index) =>
                (Date.parse(`${period.start}T00:00:00`) - Date.parse(`${periods[index].start}T00:00:00`)) / 86400000
            ).filter((days) => days >= 15 && days <= 60);
            const averageCycle = cycleLengths.length
                ? Math.round(cycleLengths.reduce((sum, days) => sum + days, 0) / cycleLengths.length)
                : null;
            const averageDuration = durations.length
                ? Math.round(durations.reduce((sum, days) => sum + days, 0) / durations.length)
                : null;

            setStat("analyticsAverageCycle", averageCycle ? `${averageCycle} days` : "--");
            setStat("analyticsAverageDuration", averageDuration ? `${averageDuration} days` : "--");
            setStat("analyticsPeriodCount", String(periods.length));
            setStat("analyticsLastPeriod", "--");
            setStat("analyticsNextPeriod", "--");
            setStat("analyticsCycleDay", "--");

            if (periods.length) {
                const lastPeriod = periods[periods.length - 1];
                setStat("analyticsLastPeriod", `${formatDate(lastPeriod.start)} – ${formatDate(lastPeriod.end)}`);
                const lastStart = new Date(`${lastPeriod.start}T00:00:00`);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const elapsedDays = Math.floor((today - lastStart) / 86400000);
                if (elapsedDays >= 0) setStat("analyticsCycleDay", String(elapsedDays + 1));
                if (averageCycle && elapsedDays >= 0) {
                    lastStart.setDate(lastStart.getDate() + averageCycle);
                    setStat("analyticsNextPeriod", formatDate(
                        `${lastStart.getFullYear()}-${String(lastStart.getMonth() + 1).padStart(2, "0")}-${String(lastStart.getDate()).padStart(2, "0")}`
                    ));
                }
            }

            const symptomCounts = new Map();
            symptomResult.items.forEach((record) => {
                (Array.isArray(record.symptoms) ? record.symptoms : []).forEach((symptom) => {
                    symptomCounts.set(symptom, (symptomCounts.get(symptom) || 0) + 1);
                });
            });
            const frequentSymptoms = [...symptomCounts.entries()]
                .map(([label, count]) => ({ label, count }))
                .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
                .slice(0, 5);
            renderBars("analyticsSymptoms", frequentSymptoms, 0, "No symptom records yet.", false);

            const moodCounts = new Map();
            moodResult.items.forEach((record) => {
                moodCounts.set(record.mood, (moodCounts.get(record.mood) || 0) + 1);
            });
            const moodDistribution = [...moodCounts.entries()]
                .map(([label, count]) => ({ label, count }))
                .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
            const moodTotal = moodDistribution.reduce((sum, entry) => sum + entry.count, 0);
            renderBars("analyticsMoods", moodDistribution, moodTotal, "No mood entries yet.", true);
            setMessage(status, "Based on your saved records. Cycle predictions are estimates, not medical advice.");
        } catch (error) {
            setMessage(status, `Unable to load analytics: ${error.message}`, true);
        }
    }

    function initAuth() {
        const signup = byId("signupForm");
        if (signup) signup.addEventListener("submit", async (event) => {
            event.preventDefault();
            const message = byId("signupMessage");
            const password = byId("password").value;
            if (password !== byId("confirmPassword").value) {
                setMessage(message, "Passwords do not match.", true);
                return;
            }
            const role = document.querySelector('input[name="role"]:checked');
            if (!role) {
                setMessage(message, "Please select an account type.", true);
                return;
            }
            setMessage(message, "Creating your account...");
            try {
                const result = await api("/auth/signup", json("POST", {
                    name: byId("name").value.trim(),
                    email: byId("email").value.trim(),
                    password,
                    role: role.value
                }));
                localStorage.setItem(tokenKey, result.token);
                localStorage.setItem("hercycleCurrentUser", JSON.stringify(result.user));
                window.location.href = result.user.role === "girl" ? "dashboard.html" : "boy-dashboard.html";
            } catch (error) {
                setMessage(message, error.message, true);
            }
        });

        const login = byId("loginForm");
        if (login) login.addEventListener("submit", async (event) => {
            event.preventDefault();
            const message = byId("loginMessage");
            setMessage(message, "Logging in...");
            try {
                const result = await api("/auth/login", json("POST", {
                    email: byId("loginEmail").value.trim(),
                    password: byId("loginPassword").value
                }));
                localStorage.setItem(tokenKey, result.token);
                localStorage.setItem("hercycleCurrentUser", JSON.stringify(result.user));
                window.location.href = result.user.role === "girl" ? "dashboard.html" : "boy-dashboard.html";
            } catch (error) {
                setMessage(message, error.message, true);
            }
        });
    }

    async function initTracker() {
        const startInput = byId("startDate");
        const endInput = byId("endDate");
        const message = byId("message");
        let periods = [];
        let editingId = null;
        const load = async () => {
            const result = await api("/periods");
            periods = result.items;
            display();
        };
        window.savePeriod = async () => {
            const start = startInput.value;
            const end = endInput.value;
            if (!start || !end || end < start || start > today()) {
                setMessage(message, "Enter valid dates. The end must be on or after the start, and the start cannot be in the future.", true);
                return;
            }
            const duration = (Date.parse(`${end}T00:00:00`) - Date.parse(`${start}T00:00:00`)) / 86400000 + 1;
            if (duration > 15) {
                setMessage(message, "Please check the dates. The duration seems unusually long.", true);
                return;
            }
            try {
                if (editingId) {
                    await api(`/periods/${editingId}`, json("PUT", { start, end }));
                    editingId = null;
                    byId("savePeriodButton").textContent = "Save Period Record";
                } else {
                    await api("/periods", json("POST", { start, end }));
                }
                startInput.value = "";
                endInput.value = "";
                setMessage(message, "Your period record has been saved!");
                await load();
            } catch (error) {
                setMessage(message, error.message, true);
            }
        };
        window.deletePeriod = async (id) => {
            if (!window.confirm("Are you sure you want to delete this record?")) return;
            try {
                await api(`/periods/${id}`, { method: "DELETE" });
                await load();
            } catch (error) {
                setMessage(message, error.message, true);
            }
        };
        function display() {
            const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
            const cycles = sorted.slice(1).map((item, index) =>
                (Date.parse(`${item.start}T00:00:00`) - Date.parse(`${sorted[index].start}T00:00:00`)) / 86400000
            ).filter((days) => days >= 15 && days <= 60);
            const durations = sorted.map((item) =>
                (Date.parse(`${item.end}T00:00:00`) - Date.parse(`${item.start}T00:00:00`)) / 86400000 + 1
            );
            const averageCycle = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null;
            byId("averageCycle").textContent = averageCycle || "--";
            byId("averagePeriod").textContent = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : "--";
            byId("nextPeriod").textContent = "--";
            byId("cycleDay").textContent = "--";
            if (sorted.length) {
                const last = new Date(`${sorted[sorted.length - 1].start}T00:00:00`);
                const day = Math.floor((new Date(`${today()}T00:00:00`) - last) / 86400000);
                if (day >= 0) byId("cycleDay").textContent = day + 1;
                if (averageCycle && day >= 0) {
                    last.setDate(last.getDate() + averageCycle);
                    byId("nextPeriod").textContent = last.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
                }
            }
            const history = byId("periodHistory");
            history.replaceChildren();
            if (!periods.length) {
                history.textContent = "No period records yet.";
                return;
            }
            [...periods].reverse().forEach((period) => {
                const entry = document.createElement("div");
                entry.className = "period-entry";
                const label = document.createElement("strong");
                label.textContent = `${period.start} – ${period.end}`;
                const edit = document.createElement("button");
                edit.textContent = "Edit";
                edit.onclick = () => {
                    editingId = period.id;
                    startInput.value = period.start;
                    endInput.value = period.end;
                    byId("savePeriodButton").textContent = "Update Period Record";
                    startInput.scrollIntoView({ behavior: "smooth", block: "center" });
                };
                const remove = document.createElement("button");
                remove.textContent = "Delete Record";
                remove.onclick = () => window.deletePeriod(period.id);
                entry.append(label, document.createElement("br"), edit, remove);
                history.appendChild(entry);
            });
        }
        try { await load(); } catch (error) { setMessage(message, error.message, true); }
    }

    async function initSymptoms() {
        const message = byId("message");
        let records = [];
        const load = async () => {
            records = (await api("/symptoms")).items;
            display();
        };
        window.saveSymptoms = async () => {
            const date = byId("symptomDate").value;
            const selectedSymptoms = [...document.querySelectorAll(".symptom-options input:checked")].map((input) => input.value);
            const severity = byId("severity").value;
            if (!date || date > today() || !selectedSymptoms.length || !severity) {
                setMessage(message, "Choose today or an earlier date, at least one symptom, and a severity.", true);
                return;
            }
            try {
                await api("/symptoms", json("POST", {
                    date, symptoms: selectedSymptoms, severity, notes: byId("notes").value.trim()
                }));
                document.querySelectorAll(".symptom-options input").forEach((input) => { input.checked = false; });
                byId("severity").value = "";
                byId("notes").value = "";
                byId("symptomDate").value = "";
                setMessage(message, "Your symptoms have been saved!");
                await load();
            } catch (error) { setMessage(message, error.message, true); }
        };
        window.deleteSymptom = async (id) => {
            if (!window.confirm("Are you sure you want to delete this record?")) return;
            try { await api(`/symptoms/${id}`, { method: "DELETE" }); await load(); }
            catch (error) { setMessage(message, error.message, true); }
        };
        function display() {
            const history = byId("symptomHistory");
            history.replaceChildren();
            if (!records.length) { history.textContent = "No symptom records yet."; return; }
            records.forEach((record) => {
                const entry = document.createElement("div");
                entry.className = "history-entry";
                const title = document.createElement("strong");
                title.textContent = record.date;
                const symptoms = document.createElement("p");
                symptoms.textContent = `Symptoms: ${record.symptoms.join(", ")}`;
                const severity = document.createElement("p");
                severity.textContent = `Severity: ${record.severity}`;
                entry.append(title, symptoms, severity);
                if (record.notes) {
                    const notes = document.createElement("p");
                    notes.textContent = `Notes: ${record.notes}`;
                    entry.appendChild(notes);
                }
                const remove = document.createElement("button");
                remove.textContent = "Delete Record";
                remove.onclick = () => window.deleteSymptom(record.id);
                entry.appendChild(remove);
                history.appendChild(entry);
            });
        }
        try { await load(); } catch (error) { setMessage(message, error.message, true); }
    }

    async function initMood() {
        const form = byId("moodForm");
        const message = byId("moodMessage");
        let records = [];
        byId("moodDate").value = today();
        byId("moodIntensity").addEventListener("input", () => {
            byId("intensityValue").textContent = `${byId("moodIntensity").value} / 5`;
        });
        const load = async () => { records = (await api("/moods")).items; display(); };
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const selected = document.querySelector('input[name="mood"]:checked');
            if (!selected) { setMessage(message, "Please select your mood.", true); return; }
            try {
                const existing = records.find((item) => item.date === byId("moodDate").value);
                await api("/moods", json("POST", {
                    date: byId("moodDate").value,
                    mood: selected.value,
                    intensity: Number(byId("moodIntensity").value),
                    notes: byId("moodNotes").value.trim()
                }));
                setMessage(message, existing ? "Your mood entry has been updated!" : "Your mood has been saved successfully!");
                form.reset();
                byId("moodDate").value = today();
                byId("moodIntensity").value = 3;
                byId("intensityValue").textContent = "3 / 5";
                await load();
            } catch (error) { setMessage(message, error.message, true); }
        });
        async function remove(id) {
            try { await api(`/moods/${id}`, { method: "DELETE" }); setMessage(message, "Mood entry deleted."); await load(); }
            catch (error) { setMessage(message, error.message, true); }
        }
        function display() {
            const container = byId("moodHistoryList");
            container.replaceChildren();
            if (!records.length) {
                const empty = document.createElement("p");
                empty.className = "empty-message";
                empty.textContent = "No mood entries yet. Start your journal today!";
                container.appendChild(empty);
                return;
            }
            const emojis = { Happy: "😊", Calm: "😌", Sad: "😢", Anxious: "😟", Irritated: "😤", Tired: "😴", Emotional: "🥺", Energetic: "⚡" };
            records.forEach((record) => {
                const card = document.createElement("div");
                card.className = "mood-entry";
                const heading = document.createElement("div");
                heading.className = "mood-entry-header";
                const title = document.createElement("h3");
                title.textContent = `${emojis[record.mood] || ""} ${record.mood}`;
                const date = document.createElement("span");
                date.textContent = record.date;
                heading.append(title, date);
                const intensity = document.createElement("p");
                intensity.textContent = `Intensity: ${record.intensity}/5`;
                const notes = document.createElement("p");
                notes.textContent = record.notes || "No notes added.";
                const removeButton = document.createElement("button");
                removeButton.className = "delete-mood";
                removeButton.textContent = "Delete";
                removeButton.onclick = () => remove(record.id);
                card.append(heading, intensity, notes, removeButton);
                container.appendChild(card);
            });
        }
        try { await load(); } catch (error) { setMessage(message, error.message, true); }
    }

    async function initReminders() {
        const message = byId("message");
        let reminders = [];
        let periods = [];
        const load = async () => {
            [reminders, periods] = await Promise.all([
                api("/reminders").then((result) => result.items),
                api("/periods").then((result) => result.items)
            ]);
            display();
            displayCycleReminder();
        };
        window.addReminder = async () => {
            const title = byId("reminderTitle").value.trim();
            const date = byId("reminderDate").value;
            const type = byId("reminderType").value;
            if (!title || !date || !type) { setMessage(message, "Please fill in all required fields.", true); return; }
            try {
                await api("/reminders", json("POST", { title, date, type, notes: byId("reminderNotes").value.trim() }));
                byId("reminderTitle").value = "";
                byId("reminderDate").value = "";
                byId("reminderType").value = "";
                byId("reminderNotes").value = "";
                setMessage(message, "Reminder saved successfully!");
                await load();
            } catch (error) { setMessage(message, error.message, true); }
        };
        async function toggle(id, completed) {
            try { await api(`/reminders/${id}`, json("PATCH", { completed: !completed })); await load(); }
            catch (error) { setMessage(message, error.message, true); }
        }
        async function remove(id) {
            if (!window.confirm("Delete this reminder?")) return;
            try { await api(`/reminders/${id}`, { method: "DELETE" }); await load(); }
            catch (error) { setMessage(message, error.message, true); }
        }
        function display() {
            const list = byId("reminderList");
            list.replaceChildren();
            if (!reminders.length) { list.textContent = "No reminders added yet."; return; }
            reminders.forEach((reminder) => {
                const entry = document.createElement("div");
                entry.className = "reminder-entry";
                const title = document.createElement("h3");
                title.textContent = reminder.title;
                const date = document.createElement("p");
                date.textContent = `Date: ${reminder.date}`;
                const type = document.createElement("p");
                type.textContent = `Type: ${reminder.type}`;
                const status = document.createElement("p");
                status.textContent = `Status: ${reminder.completed ? "Completed" : "Pending"}`;
                entry.append(title, date, type);
                if (reminder.notes) {
                    const notes = document.createElement("p");
                    notes.textContent = `Notes: ${reminder.notes}`;
                    entry.appendChild(notes);
                }
                entry.appendChild(status);
                const complete = document.createElement("button");
                complete.textContent = reminder.completed ? "Mark as Pending" : "Mark as Completed";
                complete.onclick = () => toggle(reminder.id, reminder.completed);
                const removeButton = document.createElement("button");
                removeButton.textContent = "Delete";
                removeButton.style.marginLeft = "8px";
                removeButton.onclick = () => remove(reminder.id);
                entry.append(complete, removeButton);
                list.appendChild(entry);
            });
        }
        function displayCycleReminder() {
            const target = byId("cycleReminder");
            const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
            if (sorted.length < 2) {
                target.textContent = "Record at least two period start dates to calculate an estimated next period.";
                return;
            }
            const differences = sorted.slice(1).map((item, index) =>
                (Date.parse(`${item.start}T00:00:00`) - Date.parse(`${sorted[index].start}T00:00:00`)) / 86400000
            ).filter((days) => days >= 15 && days <= 60);
            if (!differences.length) { target.textContent = "Not enough valid cycle data to estimate your next period yet."; return; }
            const average = Math.round(differences.reduce((a, b) => a + b, 0) / differences.length);
            const nextDate = new Date(`${sorted[sorted.length - 1].start}T00:00:00`);
            nextDate.setDate(nextDate.getDate() + average);
            target.textContent = `Your next period may start around ${nextDate.toLocaleDateString("en-IN")}. This is only an estimate based on your previous records.`;
        }
        try { await load(); } catch (error) { setMessage(message, error.message, true); }
    }

    async function initReports() {
        const monthInput = byId("reportMonth");
        const date = new Date();
        monthInput.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        let datasets;
        try {
            datasets = await Promise.all(["/periods", "/symptoms", "/moods"].map((url) => api(url).then((result) => result.items)));
        } catch (error) {
            const heading = document.querySelector(".reports-heading");
            const status = document.createElement("p");
            status.setAttribute("role", "alert");
            status.textContent = error.message;
            heading.appendChild(status);
            return;
        }
        const [periods, symptoms, moods] = datasets;
        const daysBetween = (start, end) => (Date.parse(`${end}T00:00:00`) - Date.parse(`${start}T00:00:00`)) / 86400000;
        const average = (values) => values.length ? `${Math.round(values.reduce((a, b) => a + b, 0) / values.length)} days` : "--";
        const item = (text) => {
            const div = document.createElement("div");
            div.className = "report-item";
            div.textContent = text;
            return div;
        };
        const render = () => {
            const selected = monthInput.value;
            if (!selected) return;
            const monthlyPeriods = periods.filter((entry) => entry.start.slice(0, 7) === selected).sort((a, b) => a.start.localeCompare(b.start));
            const monthlySymptoms = symptoms.filter((entry) => entry.date.slice(0, 7) === selected);
            const monthlyMoods = moods.filter((entry) => entry.date.slice(0, 7) === selected);
            byId("reportPeriodCount").textContent = monthlyPeriods.length;
            byId("reportSymptomCount").textContent = monthlySymptoms.length;
            byId("reportMoodCount").textContent = monthlyMoods.length;
            byId("reportAverageDuration").textContent = average(monthlyPeriods.map((entry) => daysBetween(entry.start, entry.end) + 1));
            const sortedAll = [...periods].sort((a, b) => a.start.localeCompare(b.start));
            const cycleLengths = monthlyPeriods.map((entry) => {
                const index = sortedAll.findIndex((period) => period.start === entry.start);
                return index >= 0 && index < sortedAll.length - 1 ? daysBetween(entry.start, sortedAll[index + 1].start) : null;
            }).filter((value) => value > 0);
            byId("reportAverageCycle").textContent = average(cycleLengths);
            const symptomBox = byId("reportSymptoms");
            symptomBox.replaceChildren();
            if (!monthlySymptoms.length) symptomBox.textContent = "No symptom records for this month.";
            else {
                const counts = {};
                monthlySymptoms.forEach((entry) => entry.symptoms.forEach((symptom) => { counts[symptom] = (counts[symptom] || 0) + 1; }));
                Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([symptom, count]) => symptomBox.appendChild(item(`${symptom}: ${count} time(s)`)));
                monthlySymptoms.forEach((entry) => symptomBox.appendChild(item(`${entry.date} - Severity: ${entry.severity}`)));
            }
            const moodBox = byId("reportMoods");
            moodBox.replaceChildren();
            if (!monthlyMoods.length) moodBox.textContent = "No mood entries for this month.";
            else {
                const counts = {};
                monthlyMoods.forEach((entry) => { counts[entry.mood] = (counts[entry.mood] || 0) + 1; });
                Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([mood, count]) => moodBox.appendChild(item(`${mood}: ${count} time(s)`)));
                monthlyMoods.filter((entry) => entry.notes).forEach((entry) => moodBox.appendChild(item(`${entry.date} - Note: ${entry.notes}`)));
            }
            const history = byId("reportPeriodHistory");
            history.replaceChildren();
            if (!monthlyPeriods.length) history.textContent = "No period records for this month.";
            else monthlyPeriods.forEach((entry) => history.appendChild(item(`Start: ${entry.start} | End: ${entry.end} | Duration: ${daysBetween(entry.start, entry.end) + 1} day(s)`)));
        };
        monthInput.addEventListener("change", render);
        render();
    }

    async function initQuestions() {
        const form = byId("questionForm");
        const input = byId("questionText");
        const message = byId("questionMessage");
        const history = byId("questionHistory");
        let questions = [];
        input.addEventListener("input", () => { byId("characterCount").textContent = `${input.value.length} / 500 characters`; });
        const load = async () => { questions = (await api("/questions")).items; display(); };
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (input.value.trim().length < 5) { setMessage(message, "Please enter a question with at least 5 characters.", true); return; }
            try {
                await api("/questions", json("POST", { category: byId("questionCategory").value, question: input.value.trim() }));
                form.reset();
                byId("characterCount").textContent = "0 / 500 characters";
                setMessage(message, "Your question has been saved anonymously!");
                await load();
            } catch (error) { setMessage(message, error.message, true); }
        });
        async function remove(id) {
            try { await api(`/questions/${id}`, { method: "DELETE" }); setMessage(message, "Question deleted."); await load(); }
            catch (error) { setMessage(message, error.message, true); }
        }
        function display() {
            history.replaceChildren();
            if (!questions.length) {
                const empty = document.createElement("p");
                empty.className = "empty-questions";
                empty.textContent = "No questions submitted yet.";
                history.appendChild(empty);
                return;
            }
            questions.forEach((question) => {
                const card = document.createElement("div");
                card.className = "question-entry";
                const header = document.createElement("div");
                header.className = "question-entry-header";
                const category = document.createElement("strong");
                category.textContent = question.category;
                const submitted = document.createElement("span");
                submitted.textContent = new Date(question.createdAt).toLocaleDateString();
                header.append(category, submitted);
                const text = document.createElement("p");
                text.textContent = question.question;
                const button = document.createElement("button");
                button.className = "delete-question";
                button.textContent = "Delete";
                button.onclick = () => remove(question.id);
                card.append(header, text, button);
                history.appendChild(card);
            });
        }
        try { await load(); } catch (error) { setMessage(message, error.message, true); }
    }

    async function initAwareness() {
        const scenarios = [
            {
                question: "Your classmate unexpectedly gets her period and asks you for a sanitary pad. What would you do?",
                options: ["A. Make a joke about the situation.", "B. Help her find a pad privately.", "C. Tell everyone in the class."],
                answer: 1, explanation: "Correct! Help her find a pad while respecting her privacy."
            },
            {
                question: "Your friend is experiencing cramps and doesn't feel like participating in an activity. What would you do?",
                options: ["A. Tell her she is overreacting.", "B. Make fun of her.", "C. Respect her feelings and ask if she needs help."],
                answer: 2, explanation: "Correct! Everyone experiences periods differently. Respect and support matter."
            },
            {
                question: "Someone makes an insensitive joke about periods in your friend group. What would you do?",
                options: ["A. Join in.", "B. Ignore it every time.", "C. Explain why the joke is disrespectful."],
                answer: 2, explanation: "Correct! Encourage respectful conversations and help break the stigma."
            },
            {
                question: "Your sister asks you to buy sanitary pads. What would you do?",
                options: ["A. Refuse because it is embarrassing.", "B. Help her without making it awkward.", "C. Make fun of her request."],
                answer: 1, explanation: "Correct! Menstrual products are normal health products."
            }
        ];
        let scenarioIndex = 0;
        let answered = false;
        const showScenario = () => {
            const scenario = scenarios[scenarioIndex];
            byId("scenario-question").textContent = scenario.question;
            const options = byId("scenario-options");
            options.replaceChildren();
            scenario.options.forEach((label, index) => {
                const button = document.createElement("button");
                button.className = "scenario-option";
                button.textContent = label;
                button.onclick = () => {
                    if (answered) return;
                    answered = true;
                    [...options.children].forEach((option, optionIndex) => {
                        option.disabled = true;
                        if (optionIndex === scenario.answer) option.classList.add("correct");
                    });
                    if (index !== scenario.answer) button.classList.add("wrong");
                    byId("scenario-feedback").textContent = `${index === scenario.answer ? "✓ " : "Not quite! "}${scenario.explanation}`;
                };
                options.appendChild(button);
            });
            byId("scenario-feedback").textContent = "";
            answered = false;
        };
        byId("nextScenarioButton").addEventListener("click", () => {
            scenarioIndex = (scenarioIndex + 1) % scenarios.length;
            showScenario();
        });
        showScenario();

        const challengeDefinitions = [
            ["basics", "Learn the Basics 📖", "Read about the four phases of the menstrual cycle."],
            ["myth", "Break a Myth 💡", "Learn one menstrual health myth and its correct fact."],
            ["kindness", "Spread Kindness 🤝", "Think of one way to support someone during menstruation."],
            ["hygiene", "Know Your Hygiene 🧼", "Learn three important menstrual hygiene practices."],
            ["conversation", "Start a Conversation 💬", "Encourage a respectful conversation about menstrual health."],
            ["body", "Understand Your Body 🌸", "Learn about common menstrual symptoms and cycle changes."],
            ["awareness", "Share Awareness 💗", "Share one useful menstrual health fact with someone."]
        ];
        let challenges = [];
        const isLoggedIn = Boolean(localStorage.getItem(tokenKey));
        const list = byId("challengeList");
        const renderChallenges = () => {
            list.replaceChildren();
            challenges.forEach((challenge) => {
                const card = document.createElement("div");
                card.className = "awareness-card challenge-item";
                const title = document.createElement("h3");
                title.textContent = challenge.title;
                const description = document.createElement("p");
                description.textContent = challenge.description;
                const points = document.createElement("p");
                points.textContent = `⭐ ${challenge.points} points`;
                const button = document.createElement("button");
                button.textContent = challenge.completed
                    ? "✓ Completed"
                    : isLoggedIn ? "Mark as Completed" : "Log in to save progress";
                button.disabled = Boolean(challenge.completed);
                button.onclick = async () => {
                    if (!isLoggedIn) {
                        window.location.href = "login.html";
                        return;
                    }
                    try {
                        await api(`/challenges/${encodeURIComponent(challenge.challengeKey)}`, { method: "PATCH" });
                        await loadChallenges();
                    } catch (error) {
                        byId("challengeMessage").textContent = error.message;
                    }
                };
                card.append(title, description, points, button);
                list.appendChild(card);
            });
            const completed = challenges.filter((challenge) => challenge.completed).length;
            byId("challengeProgress").textContent = `${completed} of ${challenges.length} challenges completed`;
            byId("challengePoints").textContent = challenges.filter((challenge) => challenge.completed).reduce((sum, challenge) => sum + challenge.points, 0);
            byId("challengeProgressBar").style.width = `${challenges.length ? completed / challenges.length * 100 : 0}%`;
            byId("challengeMessage").textContent = completed === challenges.length
                ? "Amazing! You completed all challenges. You are an Awareness Champion! 🏆"
                : completed >= 4 ? "Great progress! Keep spreading awareness. 🌸"
                    : completed ? "Good start! Complete more challenges to earn points. 💗"
                        : "Complete your first challenge to begin your awareness journey.";
        };
        async function loadChallenges() {
            const result = await api("/challenges");
            challenges = result.items;
            renderChallenges();
        }
        window.resetChallenges = async () => {
            if (!window.confirm("Are you sure you want to reset your challenge progress?")) return;
            try { await api("/challenges", { method: "DELETE" }); await loadChallenges(); }
            catch (error) { byId("challengeMessage").textContent = error.message; }
        };
        if (isLoggedIn) {
            try {
                await loadChallenges();
            } catch (error) {
                byId("challengeMessage").textContent = error.message;
            }
        } else {
            challenges = challengeDefinitions.map(([challengeKey, title, description]) => ({
                challengeKey, title, description, points: 10, completed: false
            }));
            renderChallenges();
            byId("challengeMessage").textContent = "Log in to save challenge progress to your account.";
        }
    }
})();
