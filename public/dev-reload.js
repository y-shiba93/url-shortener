const version = document.currentScript.dataset.version;
const events = new EventSource("/__dev/events");

events.onmessage = (event) => {
  if (event.data !== version) {
    events.close();
    location.reload();
  }
};
