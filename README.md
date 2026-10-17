# Hoshyar AI - Render Static Site

A safe public demonstration of the Hoshyar AI classroom interface.

## Deployment
1. Connect Render with ChatGPT or upload the files into a Git repository.
2. Create a new Render Static Site, using render.yaml as a Blueprint, or:
   - Build Command: `mkdir -p public && cp index.html styles.css app.js public/`
   - Publish Directory: `public`
3. Open the onrender.com URL provided after deployment.

## Security and state
- Demo mode only: the public website does not call n8n, ElevenLabs or Gemini.
- Live AI requires secure authentication, per-user quotas, and an authenticated backend proxy.
- No API keys are included in this static website.
- Microphone access can be requested by the browser, but live speech transcription is not enabled yet.
