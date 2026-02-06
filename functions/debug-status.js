exports.handler = async function(event, context) {
    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Hello from Debug Function", time: new Date().toISOString() })
    };
};