# API

Base path `/api/v1`. Responses use the envelope described in AGENTS.md section 6. Every executing prompt appends its endpoints here, grouped by module, in the order of the prompts.

Block format (copy for each endpoint):

```text
### <METHOD> <path>
- Module: <module name>        - Prompt: <ID>
- Auth: public | any authenticated | role/permission <name> | owner of resource
- Request: <ZodSchemaName in @app/contracts> (query/body/params)
- Response: <ZodSchemaName> (status code)
- Errors: <ERROR_CODE list with status>
- Rate limit: <limit per window and key> | none
- Notes: <idempotency, caching headers, side effects>
```

## Endpoints

(none yet; the first entries are added by prompt B0.1)
