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

pub(crate) fn distance_to_segment_meters(
    point_latitude_degrees: f64,
    point_longitude_degrees: f64,
    start_latitude_degrees: f64,
    start_longitude_degrees: f64,
    end_latitude_degrees: f64,
    end_longitude_degrees: f64,
) -> f64 {
    if !point_latitude_degrees.is_finite()
        || !point_longitude_degrees.is_finite()
        || !start_latitude_degrees.is_finite()
        || !start_longitude_degrees.is_finite()
        || !end_latitude_degrees.is_finite()
        || !end_longitude_degrees.is_finite()
    {
        return f64::INFINITY;
    }

    let origin_latitude_radians = start_latitude_degrees.to_radians();
    let point_x = local_x_meters(
        point_longitude_degrees,
        start_longitude_degrees,
        origin_latitude_radians,
    );
    let point_y = local_y_meters(point_latitude_degrees, start_latitude_degrees);
    let end_x = local_x_meters(
        end_longitude_degrees,
        start_longitude_degrees,
        origin_latitude_radians,
    );
    let end_y = local_y_meters(end_latitude_degrees, start_latitude_degrees);
    let length_squared = end_x * end_x + end_y * end_y;
    let t = if length_squared <= 0.0 {
        0.0
    } else {
        ((point_x * end_x + point_y * end_y) / length_squared).clamp(0.0, 1.0)
    };
    let projection_x = t * end_x;
    let projection_y = t * end_y;
    ((point_x - projection_x).powi(2) + (point_y - projection_y).powi(2)).sqrt()
}

fn local_x_meters(
    longitude_degrees: f64,
    origin_longitude_degrees: f64,
    origin_latitude_radians: f64,
) -> f64 {
    (longitude_degrees - origin_longitude_degrees).to_radians()
        * origin_latitude_radians.cos()
        * EARTH_RADIUS_METERS
}

fn local_y_meters(latitude_degrees: f64, origin_latitude_degrees: f64) -> f64 {
    (latitude_degrees - origin_latitude_degrees).to_radians() * EARTH_RADIUS_METERS
}
