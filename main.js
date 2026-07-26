import { API } from "./api.js";

window.addEventListener("DOMContentLoaded", async () => {

    console.log("Firebase Ready");

    await API.production.saveTest();

    console.log("Production Saved");

});
