// Scheduled Slack Bonus Update — runs Mon & Thu at 10am Madrid time
// Cron schedule configured in netlify.toml
// Reuses send-slack handler with auto mode → main channel

const sendSlack = require('./send-slack');

exports.handler = async function(event) {
    const result = await sendSlack.handler({
        httpMethod: 'POST',
        body: JSON.stringify({ mode: 'auto', test: false, preview: false })
    });

    console.log('[slack-cron]', result.statusCode, result.body);
    return result;
};
