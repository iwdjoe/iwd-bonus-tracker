exports.handler = async function(event, context) {
    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Hello World - Backend is Alive", time: new Date().toISOString() })
    };
};