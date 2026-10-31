# Anfrage an Open-Meteo (Entwurf)

An: info@open-meteo.com · Betreff: Free API use for a donation-funded open-source motorcycle app

Vor dem Absenden Name, Repository-Link und geschätzte Nutzerzahl eintragen.

---

Hello Open-Meteo team,

I'm developing **Kurvenjäger**, a free and open-source app (Android, iOS, web) that plans curvy motorcycle routes from OpenStreetMap data. It has no ads, no paid features, and no accounts. Users can make voluntary "pay what you want" donations, which only cover running costs (data hosting, developer accounts).

The app shows the weather along a planned route for the chosen departure time. Usage per user is small:

- one request per planned route, with up to 12 points along the route batched into a single call (`hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m`),
- responses are cached for 30 minutes,
- requests come directly from the users' devices (no backend), about 6 requests per active user per month.
- Expected scale: [N] monthly active users in the first year, i.e. roughly [N × 6] requests per month in total.

Attribution is shown in the app ("Wetter: Open-Meteo", CC BY 4.0).

Would this count as non-commercial use of the free API, given the voluntary donations? If not, which plan would you recommend? We would be happy to switch to a subscription once the donations allow it.

Source code: [Repository-Link]

Thank you for the great service,
[Name]
