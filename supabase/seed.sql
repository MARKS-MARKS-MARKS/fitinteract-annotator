-- Shared templates migrated only from the code's built-in defaults.
-- Run after schema.sql and rls.sql.

insert into public.query_templates (code, category, name, text, enabled, sort_order)
values (
  'COACH-SQUAT-01',
  '动作指导',
  '深蹲动作指导',
  '我要做一组深蹲，帮我看看动作，哪里不对就及时提醒我。',
  true,
  10
)
on conflict (code) do update set
  category = excluded.category,
  name = excluded.name,
  text = excluded.text,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;

insert into public.text_templates (code, category, name, text, enabled, sort_order)
values (
  'TEXT-KNEE-01',
  '膝盖轨迹',
  '膝盖内扣提醒',
  '注意膝盖有些内扣，让膝盖朝脚尖方向移动。',
  true,
  10
)
on conflict (code) do update set
  category = excluded.category,
  name = excluded.name,
  text = excluded.text,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;
