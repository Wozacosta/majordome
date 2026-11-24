// Page views only. Addresses on this site can carry an invite code or a sign-in token, so
// everything after the path is dropped before a view is counted.
window.va =
  window.va ||
  function () {
    (window.vaq = window.vaq || []).push(arguments);
  };
window.va("beforeSend", function (event) {
  return Object.assign({}, event, { url: event.url.split(/[?#]/)[0] });
});
