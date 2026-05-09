-- ゴミ処分単価を設定マスタに追加
insert into settings (key, value, label) values
  ('garbage_factory_rate_per_m3', '8000',  'ゴミ工場単価（円/m³）'),
  ('garbage_site_rate_per_m3',    '14000', 'ゴミ現場単価（円/m³）')
on conflict (key) do nothing;
