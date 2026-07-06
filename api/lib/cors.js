function setCors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function handleOptions(req, res) {
    if (req.method === "OPTIONS") {
        setCors(res);
        res.status(204).end();
        return true;
    }
    return false;
}

module.exports = { setCors, handleOptions };
