-- Quick-log favourites ("snel loggen") for voeding-app.
--
-- nutrition_favoriet: a fixed meal the user logs with one tap. coach-chat
-- turns a favourite into a nutrition_log row server-side (tools.ts
-- logFavoriet), resolving every component fresh from nutrition_product — the
-- model never sees the request before the row exists.
--
-- Hard rule: a favourite contains ONLY known products. A component is
-- {product_id, gram|stuks, basis?} and nothing else — no naam, eiwitten_g,
-- calorieen or bron — so an estimate cannot be stored by any writer. The
-- trigger below enforces this, plus that each product exists and is active.
--
-- Ordering in the app: gebruikt_aantal desc, created_at asc. gebruikt_aantal
-- is incremented by coach-chat only after a successful log.

create table public.nutrition_favoriet (
  id uuid primary key default gen_random_uuid(),
  naam text not null check (btrim(naam) <> ''),
  componenten jsonb not null,
  gebruikt_aantal integer not null default 0 check (gebruikt_aantal >= 0),
  laatst_gebruikt_op timestamptz,
  actief boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index nutrition_favoriet_naam_key on public.nutrition_favoriet (lower(naam)) where actief;

alter table public.nutrition_favoriet enable row level security;
create policy "Public access" on public.nutrition_favoriet for all using (true) with check (true);

comment on column public.nutrition_favoriet.componenten is
  'Ordered [{product_id, gram|stuks, basis?}] — exactly one of gram/stuks (> 0), basis rauw|bereid or absent, no other keys. Every product_id must be an active nutrition_product row (trigger nutrition_favoriet_valideer). Values are never stored here; they are resolved from nutrition_product at log time.';

create or replace function public.nutrition_favoriet_valideer() returns trigger
language plpgsql as $$
declare
  c jsonb;
  sleutel text;
  heeft_gram boolean;
  heeft_stuks boolean;
begin
  if jsonb_typeof(new.componenten) <> 'array' or jsonb_array_length(new.componenten) = 0 then
    raise exception 'componenten moet een niet-lege array zijn';
  end if;

  for c in select value from jsonb_array_elements(new.componenten) loop
    if jsonb_typeof(c) <> 'object' then
      raise exception 'component is geen object: %', c;
    end if;
    for sleutel in select jsonb_object_keys(c) loop
      if sleutel not in ('product_id', 'gram', 'stuks', 'basis') then
        raise exception 'component heeft een niet-toegestaan veld %: een favoriet bevat alleen product_id, gram/stuks en basis', sleutel;
      end if;
    end loop;
    if coalesce(c->>'product_id', '') = '' then
      raise exception 'component zonder product_id: een favoriet bevat alleen bekende producten';
    end if;
    if not exists (select 1 from public.nutrition_product p where p.id::text = c->>'product_id' and p.actief) then
      raise exception 'component verwijst naar onbekend of inactief product %', c->>'product_id';
    end if;
    heeft_gram := c ? 'gram' and jsonb_typeof(c->'gram') <> 'null';
    heeft_stuks := c ? 'stuks' and jsonb_typeof(c->'stuks') <> 'null';
    if heeft_gram = heeft_stuks then
      raise exception 'component % heeft niet precies één van gram of stuks', c->>'product_id';
    end if;
    if heeft_gram and (jsonb_typeof(c->'gram') <> 'number' or (c->>'gram')::numeric <= 0) then
      raise exception 'component % heeft een ongeldige gram', c->>'product_id';
    end if;
    if heeft_stuks and (jsonb_typeof(c->'stuks') <> 'number' or (c->>'stuks')::numeric <= 0) then
      raise exception 'component % heeft een ongeldig aantal stuks', c->>'product_id';
    end if;
    if c ? 'basis' and coalesce(c->>'basis', '') not in ('rauw', 'bereid') then
      raise exception 'component % heeft ongeldige basis: %', c->>'product_id', c->>'basis';
    end if;
  end loop;

  return new;
end;
$$;

create trigger nutrition_favoriet_valideer
  before insert or update of componenten on public.nutrition_favoriet
  for each row execute function public.nutrition_favoriet_valideer();
