-- Product table + per-component breakdown on nutrition_log.
--
-- nutrition_product: known products with package/user-supplied values. The
-- coach computes product components server-side from these rows instead of
-- estimating (coach-chat/tools.ts). Meat/fish rows record whether their
-- values are per 100g raw or cooked (gewicht_basis); raw and cooked are
-- separate rows.
--
-- nutrition_log.componenten: one entry per component. When set, the
-- BEFORE trigger below rounds each component (eiwit 0.1g, kcal whole) and
-- OVERWRITES the row's eiwitten_g/calorieen with the sum of the rounded
-- components — for every writer (edge function, SQL, anon client), so the
-- row and its components can never disagree. Rows with componenten = null
-- (everything logged before this migration) are untouched.

create table public.nutrition_product (
  id uuid primary key default gen_random_uuid(),
  naam text not null check (btrim(naam) <> ''),
  zoektermen text[] not null default '{}',
  gewicht_basis text not null default 'nvt' check (gewicht_basis in ('nvt', 'rauw', 'bereid')),
  eiwit_per_100g numeric check (eiwit_per_100g >= 0),
  kcal_per_100g numeric check (kcal_per_100g >= 0),
  stuk_naam text,
  stuk_gewicht_g numeric check (stuk_gewicht_g > 0),
  eiwit_per_stuk numeric check (eiwit_per_stuk >= 0),
  kcal_per_stuk numeric check (kcal_per_stuk >= 0),
  bron text not null check (bron in ('verpakking', 'gebruiker')),
  notitie text,
  actief boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- eiwit and kcal always come as a pair per basis
  constraint per_100g_paar check ((eiwit_per_100g is null) = (kcal_per_100g is null)),
  constraint per_stuk_paar check ((eiwit_per_stuk is null) = (kcal_per_stuk is null)),
  -- at least one usable basis
  constraint heeft_waarden check (eiwit_per_100g is not null or eiwit_per_stuk is not null),
  -- a piece weight or per-piece values need a piece name ("plak", "pak")
  constraint stuk_heeft_naam check ((stuk_gewicht_g is null and eiwit_per_stuk is null) or stuk_naam is not null)
);

create unique index nutrition_product_naam_basis_key on public.nutrition_product (lower(naam), gewicht_basis);

alter table public.nutrition_product enable row level security;
create policy "Public access" on public.nutrition_product for all using (true) with check (true);

alter table public.nutrition_log add column componenten jsonb;

comment on column public.nutrition_log.componenten is
  'Per-component breakdown [{naam, hoeveelheid, gram, stuks, basis, eiwitten_g, calorieen, bron: product|geschat|gebruiker, product_id}]. When set, trigger nutrition_log_sync_componenten overwrites eiwitten_g/calorieen with the sum of the rounded components. NULL for every row logged before 2026-10-05 (the date this column was added) — a date boundary, not missing data.';

create or replace function public.nutrition_log_sync_componenten() returns trigger
language plpgsql as $$
declare
  c jsonb;
  genormaliseerd jsonb := '[]'::jsonb;
  e numeric;
  k numeric;
  som_e numeric := 0;
  som_k numeric := 0;
begin
  if new.componenten is null or jsonb_typeof(new.componenten) = 'null' then
    new.componenten := null;
    return new;
  end if;
  if jsonb_typeof(new.componenten) <> 'array' or jsonb_array_length(new.componenten) = 0 then
    raise exception 'componenten moet een niet-lege array zijn';
  end if;

  for c in select value from jsonb_array_elements(new.componenten) loop
    if jsonb_typeof(c) <> 'object' then
      raise exception 'component is geen object: %', c;
    end if;
    if coalesce(btrim(c->>'naam'), '') = '' then
      raise exception 'component zonder naam: %', c;
    end if;
    if coalesce(jsonb_typeof(c->'eiwitten_g'), '') <> 'number' or coalesce(jsonb_typeof(c->'calorieen'), '') <> 'number' then
      raise exception 'component % mist een numerieke eiwitten_g/calorieen', c->>'naam';
    end if;
    if coalesce(c->>'bron', '') not in ('product', 'geschat', 'gebruiker') then
      raise exception 'component % heeft ongeldige bron: %', c->>'naam', c->>'bron';
    end if;
    if c->>'bron' = 'product' then
      if coalesce(c->>'product_id', '') = '' then
        raise exception 'component % met bron product mist product_id', c->>'naam';
      end if;
      if not exists (select 1 from public.nutrition_product p where p.id::text = c->>'product_id') then
        raise exception 'component % verwijst naar onbekend product %', c->>'naam', c->>'product_id';
      end if;
    end if;
    if c->>'basis' is not null and c->>'basis' not in ('rauw', 'bereid') then
      raise exception 'component % heeft ongeldige basis: %', c->>'naam', c->>'basis';
    end if;

    e := round((c->>'eiwitten_g')::numeric, 1);
    k := round((c->>'calorieen')::numeric, 0);
    if e < 0 or k < 0 then
      raise exception 'component % heeft een negatieve waarde', c->>'naam';
    end if;

    genormaliseerd := genormaliseerd || jsonb_build_array(c || jsonb_build_object('eiwitten_g', e, 'calorieen', k));
    som_e := som_e + e;
    som_k := som_k + k;
  end loop;

  new.componenten := genormaliseerd;
  new.eiwitten_g := som_e;
  new.calorieen := som_k;
  return new;
end;
$$;

create trigger nutrition_log_sync_componenten
  before insert or update on public.nutrition_log
  for each row execute function public.nutrition_log_sync_componenten();
