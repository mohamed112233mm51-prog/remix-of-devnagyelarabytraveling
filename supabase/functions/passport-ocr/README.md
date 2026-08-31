# Passport OCR Edge Function

This function reads passport biodata images transiently and does not write the image or base64 payload to Supabase Storage or database tables.

## Provider

The function uses the Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) with the project-managed `LOVABLE_API_KEY` secret. No external OpenAI key is required.

Default vision model: `google/gemini-3.1-pro-preview`.

Optional model override:

```bash
npx supabase secrets set PASSPORT_OCR_MODEL=google/gemini-3.7-flash --project-ref fjwdmkinqilwntlqdjgv
```

## Deploy

```bash
npx supabase functions deploy passport-ocr --project-ref fjwdmkinqilwntlqdjgv
```

The function requires an authenticated Supabase user (`verify_jwt = true`). The image is held only in request memory and is discarded after extraction; nothing is persisted or logged.
