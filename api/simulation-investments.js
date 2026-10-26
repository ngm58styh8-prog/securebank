const { setRegistryCors, handleRegistryOptions } = require("../server-lib/registry-cors");
const { isRegistryConfigured, registryConfigError, normalizeRegistryEmail } = require("../server-lib/registry");
const { assertAdminAuthorized, appendAdminActivityLog } = require("../server-lib/admin-auth");
const {
    getAdminInvestmentOverview,
    listAdminInvestments,
    listSimulationPlans,
    upsertSimulationPlan,
    saveSimulationSettings,
    processSimulationCreditForUser,
    processAllSimulationCredits,
    getSimulationHistory,
    getMonitoringDashboard,
    exportInvestmentsReport,
    ensureDefaultSimulationPlans,
    enrollInSimulationPlan,
    getCustomerInvestmentPortfolio,
    getCustomerInvestmentHistory,
    listPublicPlansForAsset
} = require("../server-lib/simulation-investments");

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
            const creds = {
                adminEmail: query.adminEmail,
                adminPassword: query.adminPassword
            };

            if (action === "portfolio") {
                const email = normalizeRegistryEmail(query.email);
                const result = await getCustomerInvestmentPortfolio(email);
                res.status(result.ok ? 200 : 404).json(result);
                return;
            }

            if (action === "asset-plans") {
                const result = await listPublicPlansForAsset(String(query.assetId || "").toLowerCase());
                res.status(200).json(result);
                return;
            }

            if (action === "customer-history") {
                const email = normalizeRegistryEmail(query.email);
                const result = await getCustomerInvestmentHistory(email, query.filter || "all");
                res.status(result.ok ? 200 : 404).json(result);
                return;
            }

            if (action === "overview") {
                await assertAdminAuthorized(req, creds);
                const result = await getAdminInvestmentOverview();
                res.status(200).json(result);
                return;
            }

            if (action === "investments") {
                await assertAdminAuthorized(req, creds);
                const result = await listAdminInvestments(query.q || query.search, query.asset || "all");
                res.status(200).json(result);
                return;
            }

            if (action === "plans") {
                await assertAdminAuthorized(req, creds);
                const result = await listSimulationPlans();
                res.status(200).json(result);
                return;
            }

            if (action === "history") {
                await assertAdminAuthorized(req, creds);
                const result = await getSimulationHistory(Number(query.limit) || 200);
                res.status(200).json(result);
                return;
            }

            if (action === "monitoring") {
                await assertAdminAuthorized(req, creds);
                const result = await getMonitoringDashboard();
                res.status(200).json(result);
                return;
            }

            if (action === "export") {
                await assertAdminAuthorized(req, creds);
                const listed = await listAdminInvestments(query.q || "", query.asset || "all");
                const csv = exportInvestmentsReport(listed.investments || []);
                res.status(200).json({ ok: true, csv: csv });
                return;
            }

            res.status(400).json({ ok: false, error: "Missing or invalid GET action." });
            return;
        }

        if (req.method === "POST") {
            const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
            if (body.action === "enroll") {
                const result = await enrollInSimulationPlan(body.email, body.planId, body.amount);
                res.status(200).json(result);
                return;
            }

            let admin = await assertAdminAuthorized(req, body);

            if (body.action === "upsert-plan" && body.plan) {
                const result = await upsertSimulationPlan(body.plan, { delete: !!body.delete });
                res.status(200).json(result);
                return;
            }

            if (body.action === "save-settings" && body.settings) {
                const result = await saveSimulationSettings(body.settings, admin);
                res.status(200).json(result);
                return;
            }

            if (body.action === "pause-plan" && body.planId) {
                admin = await ensureDefaultSimulationPlans(admin);
                const plan = (admin.simulationPlans || []).find(function(p) {
                    return String(p.id) === String(body.planId);
                });
                if (!plan) throw new Error("Plan not found.");
                plan.paused = true;
                plan.updatedAt = new Date().toISOString();
                appendAdminActivityLog(admin, { action: "simulation-plan-pause", planId: plan.id });
                const { saveAdminRegistry } = require("../server-lib/registry");
                await saveAdminRegistry(admin);
                res.status(200).json({ ok: true, plan: plan });
                return;
            }

            if (body.action === "resume-plan" && body.planId) {
                admin = await ensureDefaultSimulationPlans(admin);
                const plan = (admin.simulationPlans || []).find(function(p) {
                    return String(p.id) === String(body.planId);
                });
                if (!plan) throw new Error("Plan not found.");
                plan.paused = false;
                plan.updatedAt = new Date().toISOString();
                appendAdminActivityLog(admin, { action: "simulation-plan-resume", planId: plan.id });
                const { saveAdminRegistry } = require("../server-lib/registry");
                await saveAdminRegistry(admin);
                res.status(200).json({ ok: true, plan: plan });
                return;
            }

            if (body.action === "process-credit" && body.email) {
                const result = await processSimulationCreditForUser(body.email, { force: !!body.force });
                res.status(200).json(result);
                return;
            }

            if (body.action === "process-all-credits") {
                const result = await processAllSimulationCredits();
                res.status(200).json(result);
                return;
            }

            res.status(400).json({ ok: false, error: "Missing or invalid POST action." });
            return;
        }

        res.status(405).json({ ok: false, error: "Method not allowed" });
    } catch (err) {
        const message = err && err.message ? err.message : "Simulation investment request failed.";
        const status = err && err.statusCode ? err.statusCode : 400;
        res.status(status).json({ ok: false, error: message });
    }
};
