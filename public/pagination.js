// Shared between app.js and admin.js. Every fetched list is small enough
// (single-user or small-multi-user data) to fetch in one request and
// paginate client-side, rather than adding page/limit params to every list
// endpoint — this keeps the pattern identical everywhere it's used.
//
// Usage: fetch the full array once, keep it + a "current page" number in
// module state, then on every (re)render call paginateItems() to slice out
// the current page and renderPagination() to draw the Prev/Next controls
// (which just call back into that same render function with a new page).

function paginateItems(items, page, pageSize) {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

// root: an empty container element. Renders nothing (and clears root) when
// everything fits on one page, so a short list never shows dead controls.
function renderPagination(root, { totalItems, pageSize, page, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  if (totalPages <= 1) {
    root.innerHTML = '';
    return;
  }

  root.innerHTML = `
    <div class="pagination">
      <button type="button" class="secondary pagination-prev" ${page <= 0 ? 'disabled' : ''}>‹ Prev</button>
      <span class="pagination-label">Page ${page + 1} of ${totalPages}</span>
      <button type="button" class="secondary pagination-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Next ›</button>
    </div>`;

  root.querySelector('.pagination-prev').addEventListener('click', () => onPageChange(Math.max(0, page - 1)));
  root.querySelector('.pagination-next').addEventListener('click', () => onPageChange(Math.min(totalPages - 1, page + 1)));
}
