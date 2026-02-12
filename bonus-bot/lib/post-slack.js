// Posts a formatted message to Slack via Incoming Webhook

async function postToSlack(webhookUrl, message) {
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Slack webhook failed (${response.status}): ${body}`);
    }

    return true;
}

module.exports = { postToSlack };
