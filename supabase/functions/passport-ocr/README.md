# Passport OCR Edge Function

This function reads passport biodata images transiently and does not write the image or base64 payload to Supabase Storage or database tables.

## Required secret

Set the OpenAI API key as a Supabase secret (never expose it to the frontend):

```bash
npx supabase secrets set OPENAI_API_KEY=YOUR_KEY --project-ref fjwdmkinqilwntlqdjgv
```

Optional model override:

```bash
npx supabase secrets set PASSPORT_OCR_MODEL=gpt-5.6-sol --project-ref fjwdmkinqilwntlqdjgv
```

## Deploy

```bash
npx supabase functions deploy passport-ocr --project-ref fjwdmkinqilwntlqdjgv
```

The function requires an authenticated Supabase user (`verify_jwt = true`) and sends the image to the vision API with `store: false`. The image is held only in request memory by the application code and is discarded after extraction.
