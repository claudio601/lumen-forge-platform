# Incident 2026-05-07 — K4 env var deletion accidental

## Summary

4 production credentials accidentally deleted from all Vercel environments while attempting to scope-narrow them to remove from Development only as part of Ticket K4 (env var scope audit).

## Timeline (UTC-3 Chile)

- 13:57: First vercel env rm <NAME> development --yes executed (Group 1 of K4)

- 14:00: Anomaly detected by Claude in Chrome (line count delta 46→42 instead of metadata-only change)

- 14:05: Verification with vercel env ls <env> confirms vars eliminated from ALL environments, not just Dev

- 14:15: Recovery plan executed (Upstash/Twilio recovered, Anthropic rotated, new key created)

- 14:42: Vercel env vars restored to Production + Preview (NOT Development, faithful to original K4 intent)

- 14:43: vercel --prod redeploy successful (46s build)

- 14:44: Smoke test HTTP 405 on /api/quotes/create confirmed Lambda runtime healthy

## Root cause

vercel env rm <NAME> <environment> --yes in Vercel CLI v53.1.1 does NOT narrow scope as the prompt assumed. The environment argument is treated as filter for "match this entry" rather than "remove only from this env scope". Combined with --yes, deletes the variable entirely without per-environment confirmation.

## Affected services during ~46 min window

- Bot WhatsApp Claude Haiku (ANTHROPIC_API_KEY)

- Twilio WABA send/receive (TWILIO_AUTH_TOKEN, TWILIO_ACCOUNT_SID)

- Bridge Jumpseller-Pipedrive (UPSTASH_REDIS_REST_TOKEN — fail-closed 503)

## Detection

Claude in Chrome paused after Group 1 + validation when grep returned empty for the 4 vars. Suggested explicit per-environment verification with vercel env ls production rather than assuming based on aggregate listing. This early pause prevented Groups 2 and 3 (8 more vars) from being affected.

## Lessons learned

1. Vercel CLI env rm with environment arg has destructive default — narrowing must be done via UI or via rm + add pattern

2. Always validate destructive operations with explicit per-environment query before assuming behavior

3. Production credentials stay with human operator only — agents orchestrate non-sensitive steps

4. Emergency authorization does NOT override security boundaries — Claude in Chrome correctly resisted unsafe shortcuts

5. Aggregate CLI output env ls without args) is NOT reliable evidence for per-environment state

## Rollback path

- Old Anthropic key elightsweb remains active until smoke tests pass

- New key lumen-forge-prod-2026-05-07-recovery is current production

- If new key fails, must rotate again (no recovery for plaintext value)

## Pending follow-ups

- Smoke tests funcionales completos (manual WhatsApp + Pipedrive audit)

- Backup new ANTHROPIC_API_KEY in password manager (Ticket K6)

- Investigate correct Vercel CLI syntax for per-environment removal

- Re-evaluate K4 continuation (Groups 2+3 with 8 vars pending)

- Deprecate old Anthropic key once smoke tests pass

## Roles in operation

- Claude.ai Web (strategy): designed the failed K4 prompt; recovery plan

- Claude in Chrome (execution): detected anomaly, refused unsafe credential handling, executed safe restoration with proper credential separation

- Claudio (operator): authorized recovery, manually entered credentials via read -s, monitored production
