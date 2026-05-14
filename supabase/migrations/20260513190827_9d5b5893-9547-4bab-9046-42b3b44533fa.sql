
-- Create public branding bucket for company logos
insert into storage.buckets (id, name, public)
values ('company-assets', 'company-assets', true)
on conflict (id) do update set public = true;

-- Public read
drop policy if exists "company-assets public read" on storage.objects;
create policy "company-assets public read"
on storage.objects for select
using (bucket_id = 'company-assets');

-- Admin write/update/delete
drop policy if exists "company-assets admin insert" on storage.objects;
create policy "company-assets admin insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'company-assets' and has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "company-assets admin update" on storage.objects;
create policy "company-assets admin update"
on storage.objects for update to authenticated
using (bucket_id = 'company-assets' and has_role(auth.uid(), 'admin'::app_role))
with check (bucket_id = 'company-assets' and has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "company-assets admin delete" on storage.objects;
create policy "company-assets admin delete"
on storage.objects for delete to authenticated
using (bucket_id = 'company-assets' and has_role(auth.uid(), 'admin'::app_role));
