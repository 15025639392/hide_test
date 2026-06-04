const EARTH_RADIUS_METERS: f64 = 6_371_000.0;

pub(crate) fn haversine_distance_meters(
    from_latitude_degrees: f64,
    from_longitude_degrees: f64,
    to_latitude_degrees: f64,
    to_longitude_degrees: f64,
) -> f64 {
    let from_latitude = from_latitude_degrees.to_radians();
    let to_latitude = to_latitude_degrees.to_radians();
    let delta_latitude = (to_latitude_degrees - from_latitude_degrees).to_radians();
    let delta_longitude = (to_longitude_degrees - from_longitude_degrees).to_radians();

    let sin_delta_latitude = (delta_latitude / 2.0).sin();
    let sin_delta_longitude = (delta_longitude / 2.0).sin();

    let a = sin_delta_latitude * sin_delta_latitude
        + from_latitude.cos() * to_latitude.cos() * sin_delta_longitude * sin_delta_longitude;
    let central_angle = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());

    EARTH_RADIUS_METERS * central_angle
}

pub(crate) fn initial_bearing_degrees(
    from_latitude_degrees: f64,
    from_longitude_degrees: f64,
    to_latitude_degrees: f64,
    to_longitude_degrees: f64,
) -> Option<f64> {
    if !from_latitude_degrees.is_finite()
        || !from_longitude_degrees.is_finite()
        || !to_latitude_degrees.is_finite()
        || !to_longitude_degrees.is_finite()
    {
        return None;
    }
    if from_latitude_degrees == to_latitude_degrees
        && from_longitude_degrees == to_longitude_degrees
    {
        return None;
    }

    let from_latitude = from_latitude_degrees.to_radians();
    let to_latitude = to_latitude_degrees.to_radians();
    let delta_longitude = (to_longitude_degrees - from_longitude_degrees).to_radians();

    let y = delta_longitude.sin() * to_latitude.cos();
    let x = from_latitude.cos() * to_latitude.sin()
        - from_latitude.sin() * to_latitude.cos() * delta_longitude.cos();
    let bearing_degrees = y.atan2(x).to_degrees().rem_euclid(360.0);

    if bearing_degrees.is_finite() {
        Some(bearing_degrees)
    } else {
        None
    }
}
