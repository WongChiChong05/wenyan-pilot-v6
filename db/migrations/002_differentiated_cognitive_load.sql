-- v5.6: Klepsch et al. (2017) eight-item differentiated cognitive-load scale.
-- Columns stay nullable so existing Paas and earlier three-item rows remain valid.
ALTER TABLE wenyan.scales
  ADD COLUMN IF NOT EXISTS intrinsic1 integer CHECK (intrinsic1 BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS intrinsic2 integer CHECK (intrinsic2 BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS germane1 integer CHECK (germane1 BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS germane2 integer CHECK (germane2 BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS germane3 integer CHECK (germane3 BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS extraneous1 integer CHECK (extraneous1 BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS extraneous2 integer CHECK (extraneous2 BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS extraneous3 integer CHECK (extraneous3 BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS intrinsic_mean double precision,
  ADD COLUMN IF NOT EXISTS germane_mean double precision,
  ADD COLUMN IF NOT EXISTS extraneous_mean double precision;
