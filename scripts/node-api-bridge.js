#!/usr/bin/env node
/**
 * Invoke a Vercel-style API handler from the Ruby dev server or CLI.
 * Usage: node scripts/node-api-bridge.js <handler-path> <METHOD> '<query-json>' [body]
 */
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = path.join(__dirname, "..");
require(path.join(root, "server-lib", "load-env.js")).loadProjectEnv(root);

if (!process.env.USE_LOCAL_REGISTRY) {
    process.env.USE_LOCAL_REGISTRY = "1";
}

const handlerRel = process.argv[2];
const method = (process.argv[3] || "GET").toUpperCase();
const queryJson = process.argv[4] || "{}";
const inlineBody = process.argv[5];

if (!handlerRel) {
    console.error("Usage: node scripts/node-api-bridge.js <handler-path> <METHOD> '<query-json>' [body]");
    process.exit(2);
}

let query = {};
try {
    query = JSON.parse(queryJson);
} catch (err) {
    console.error("Invalid query JSON:", err.message);
    process.exit(2);
}

function readStdin() {
    return new Promise(function(resolve) {
        if (inlineBody != null) {
            resolve(inlineBody);
            return;
        }
        let data = "";
        if (process.stdin.isTTY) {
            resolve("");
            return;
        }
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", function(chunk) { data += chunk; });
        process.stdin.on("end", function() { resolve(data); });
    });
}

readStdin().then(function(bodyText) {
    let body = {};
    if (bodyText && bodyText.trim()) {
        try {
            body = JSON.parse(bodyText);
        } catch (err) {
            process.stderr.write(JSON.stringify({ ok: false, error: "Invalid JSON body." }));
            process.exit(400);
            return;
        }
    }

    const handlerPath = path.isAbsolute(handlerRel)
        ? handlerRel
        : path.join(root, handlerRel);

    const handler = require(handlerPath);
    const resState = { statusCode: 500, body: null };

    const req = {
        method: method,
        query: query,
        body: body,
        headers: { "content-type": "application/json" }
    };

    const res = {
        statusCode: 200,
        status: function(code) {
            resState.statusCode = code;
            return this;
        },
        json: function(payload) {
            resState.body = payload;
            process.stdout.write(JSON.stringify(payload));
        },
        setHeader: function() {},
        end: function(payload) {
            if (payload) process.stdout.write(String(payload));
        }
    };

    return Promise.resolve(handler(req, res)).then(function() {
        process.exit(resState.statusCode >= 400 ? 1 : 0);
    });
}).catch(function(err) {
    process.stderr.write(JSON.stringify({
        ok: false,
        error: err && err.message ? err.message : String(err)
    }));
    process.exit(500);
});
