export function canUseStaffChat(user) {
  return Boolean(user && [1, 10, 50].includes(user.role_id)
    && user.account_status === "approved" && user.active
    && !user.deleted_at && !user.is_system);
}
