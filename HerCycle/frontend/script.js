window.herCycleApi = async function (path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const token = localStorage.getItem("hercycleToken");
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`/api${path}`, { ...options, headers });
    if (response.status === 204) return null;

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 && token) {
            localStorage.removeItem("hercycleToken");
            localStorage.removeItem("hercycleCurrentUser");
        }
        throw new Error(body.error || `Request failed (${response.status}).`);
    }
    return body;
};
