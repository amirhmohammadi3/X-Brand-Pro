# DEPLOYMENT

Filled progressively. Prompt I1.1 writes section 1, I12.1 and I12.2 write the rest. Do not write generic deployment steps before prompt I12.2 has researched the official documentation of the chosen hosting platform.

## 1. Environment variables

Format: table with columns `Name | Required | Used by | Description | Example (fake)`. (written by I1.1)

## 2. Services and ports

Format: one row per container with image, port, volume, health check. (written by I12.1)

## 3. Hosting platform decision

Platform name, plan limits (RAM, CPU, disk, Docker support, PostgreSQL with PostGIS support), link to the documentation pages read, date read. (written by I12.2)

## 4. First deployment procedure

Numbered steps that were actually executed and verified. (written by I12.2)

## 5. Update, rollback and backup procedure

(written by I12.3 and Q12.11)

## 6. Runbook

Common failures and the exact commands to diagnose and fix them. (written by Q12.12)
