# ROTA Scheduler Online App

This is the upload-ready version of the ROTA scheduler web app.

## Requirements

- Node.js 18 or newer
- A server that can run a Node app

## Install

```bash
npm install
```

## Start

```bash
npm start
```

By default it runs on:

```text
http://your-server:4173
```

For hosting providers that give a port automatically:

```bash
PORT=3000 npm start
```

## Database / Saved User Data

The app includes a built-in file database. It stores:

- user signups and approval status
- admin account
- saved rota templates
- calculator favorites
- rounds history
- generated Excel files

By default the database folder is:

```text
data/
```

For Render, add a persistent disk and set:

```bash
DATA_DIR=/var/data
```

Without a persistent disk, free Render services may lose saved users/data after redeploys or restarts.

## Optional OpenAI AI Review

The app works without OpenAI using the built-in rota audit.

To enable live OpenAI review:

```bash
export OPENAI_API_KEY="your_api_key_here"
export OPENAI_MODEL="gpt-4.1-mini"
npm start
```

## iPhone

Open the app in Safari, then:

Share -> Add to Home Screen

The app includes iPhone/PWA metadata, app icon, and mobile layout.

## Files

- `server.mjs`: Node server
- `src/scheduler.mjs`: rota scheduling logic
- `src/workbook.mjs`: Excel workbook exporter
- `public/`: web app, iPhone/PWA files
- `data/`: built-in database and generated Excel downloads
