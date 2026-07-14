const { setRegistryCors, handleRegistryOptions } = require("../server-lib/registry-cors");
const {
    isRegistryConfigured,
    registryConfigError
} = require("../server-lib/registry");
const {
    listGoldPlans,
    enrollInGoldPlan,
    getGoldStatus,
    getGoldHistory,
    processDailyCreditForUser,
    processAllDailyCredits,
    upsertGoldPlan,
    searchGoldInvestors,
    ensureAdminGoldPlans,
    findGoldPlan
} = require("../server-lib/gold-investments");
const { normalizeRegistryEmail, loadAdminRegistry, saveAdminRegistry } = require("../server-lib/registry");

module.exports = async function handler(req, res) {
    if (handleRegistryOptions(req, res)) return;
    setRegistryCors(res);

    if (!isRegistryConfigured()) {
        res.status(503).json(registryConfigError());
        return;
    }

    try {
        if (req.method === "GET") {
            const query = req.query || {};
            const action = query.action;

            if (action === "plans") {
                const result = await listGoldPlans();
                res.status(200).json(result);
                return;
            }

            if (action === "status") {
                const email = normalizeRegistryEmail(query.email);
                const result = await getGoldStatus(email);
                res.status(200).json(result);
                return;
            }

            if (action === "history") {
                const email = normalizeRegistryEmail(query.email);
                const result = await getGoldHistory(email);
                res.status(200).json(result);
                return;
            }

            if (action === "admin-investors") {
                const result = await searchGoldInvestors(query.q || query.search);
                res.status(200).json(result);
                return;
            }

            res.status(400).json({ ok: false, error: "Missing or invalid GET action." });
            return;
        }

        if (req.method === "POST") {
            const body = req.body || {};

            if (body.action === "enroll") {
                const result = await enrollInGoldPlan(body.email, body.planId, body.amount);
                res.status(200).json(result);
                return;
            }

            if (body.action === "process-credit") {
                const email = normalizeRegistryEmail(body.email);
                const result = await processDailyCreditForUser(email, { force: !!body.force });
                res.status(200).json(result);
                return;
            }

            if (body.action === "process-all-credits") {
                const result = await processAllDailyCredits();
                res.status(200).json(result);
                return;
            }

            if (body.action === "upsert-plan" && body.plan) {
                const result = await upsertGoldPlan(body.plan, { delete: !!body.delete });
                res.status(200).json(result);
                return;
            }

            if (body.action === "pause-plan" && body.planId) {
                const admin = await ensureAdminGoldPlans(await loadAdminRegistry());
                const plan = findGoldPlan(admin, body.planId);
                if (!plan) throw new Error("Plan not found.");
                plan.paused = true;
                plan.updatedAt = new Date().toISOString();
                await saveAdminRegistry(admin);
                res.status(200).json({ ok: true, plan: plan, plans: admin.goldPlans });
                return;
            }

            if (body.action === "resume-plan" && body.planId) {
                const admin = await ensureAdminGoldPlans(await loadAdminRegistry());
                const plan = findGoldPlan(admin, body.planId);
                if (!plan) throw new Error("Plan not found.");
                plan.paused = false;
                plan.updatedAt = new Date().toISOString();
                await saveAdminRegistry(admin);
                res.status(200).json({ ok: true, plan: plan, plans: admin.goldPlans });
                return;
            }

            res.status(400).json({ ok: false, error: "Missing or invalid POST action." });
            return;
        }

        res.status(405).json({ ok: false, error: "Method not allowed" });
    } catch (err) {
        const message = err && err.message ? err.message : "Gold investment request failed.";
        res.status(400).json({ ok: false, error: message });
    }
};
