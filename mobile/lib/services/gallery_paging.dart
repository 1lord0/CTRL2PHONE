// Pure gallery-paging helpers, extracted from SupabaseService so the filtering
// and pagination rules can be unit-tested without the Supabase SDK or a network.

/// Whether a storage object name should be shown in the gallery.
///
/// Hidden (dot) files, the `.keep` folder marker, the `to_pc` transfer folder,
/// and null names are excluded; everything else is a real screenshot.
bool isVisiblePhotoName(String? name) {
  if (name == null || name.isEmpty) return false;
  if (name.startsWith('.')) return false;
  if (name.endsWith('.keep')) return false;
  if (name == 'to_pc') return false;
  return true;
}

/// Whether the server likely has another page.
///
/// Pagination is decided on the RAW server count (before visibility filtering),
/// so hiding `.keep` / `to_pc` / hidden rows never cuts the gallery short. A full
/// page (raw count == requested limit) means there may be more; a short page means
/// the end was reached. `.list(limit: n)` never returns more than `n` rows, so this
/// is exactly the original `objects.length == limit` rule.
bool computeHasMore(int rawCount, int limit) => rawCount == limit;
