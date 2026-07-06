function setRegistryCors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function handleRegistryOptions(req, res) {
    if (req.method === "OPTIONS") {
        setRegistryCors(res);
        res.status(204).end();
        return true;
    }
    return false;
}

module.exports = { setRegistryCors, handleRegistryOptions };
