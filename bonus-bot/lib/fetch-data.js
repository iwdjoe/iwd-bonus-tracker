// Fetches monthly stats from the Team Bonus Tracker API
// The API returns: users[], projects[], meta{}

async function fetchDashboardData(apiUrl) {
    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error(`Dashboard API returned ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();

    // Validate expected shape
    if (!data.users || !data.projects) {
        throw new Error('Unexpected API response — missing users or projects');
    }

    return data;
}

module.exports = { fetchDashboardData };
