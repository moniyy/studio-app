-- The admin's read-only look at a studio's dashboard shows its hours again
-- (owner_schedule became security definer with the team migration).
create or replace function public.owner_schedule(p_master_id uuid, p_staff_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff uuid;
  m public.masters;
begin
  -- the owner, or the platform admin looking (read only)
  if private.is_my_master(p_master_id) or private.is_admin() then
    v_staff := coalesce(p_staff_id, (select id from public.staff where master_id = p_master_id and is_owner));
  else
    v_staff := private.my_staff_id(p_master_id);
    if v_staff is null then raise exception 'forbidden'; end if;
  end if;
  select * into m from public.masters where id = p_master_id;
  return jsonb_build_object(
    'staff_id', v_staff,
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', w.weekday,
                         'start', to_char(w.start_time, 'HH24:MI'), 'end', to_char(w.end_time, 'HH24:MI'))
                         order by w.weekday, w.start_time)
                         from public.working_hours w where w.staff_id = v_staff), '[]'::jsonb),
    'time_off', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'start_at', o.start_at,
                            'end_at', o.end_at, 'reason', o.reason, 'whole_studio', o.staff_id is null) order by o.start_at)
                            from public.time_off o where o.master_id = m.id and o.end_at > now()
                             and (o.staff_id = v_staff or o.staff_id is null)), '[]'::jsonb),
    'rules', jsonb_build_object('auto_confirm', m.auto_confirm, 'min_notice_hours', m.min_notice_hours,
                                'max_days_ahead', m.max_days_ahead, 'cancel_window_hours', m.cancel_window_hours,
                                'slot_step_min', m.slot_step_min, 'deposit_hold_hours', m.deposit_hold_hours,
                                'noshow_deposit', m.noshow_deposit,
                                'takes_deposits', private.takes_deposits(m.settings)));
end $$;
