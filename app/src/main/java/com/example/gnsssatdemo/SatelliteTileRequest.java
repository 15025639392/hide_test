package com.example.gnsssatdemo;

class SatelliteTileRequest {
    final int zoom;
    final int tileX;
    final int tileY;
    final String key;
    final double priority;

    SatelliteTileRequest(int zoom, int tileX, int tileY, String key, double priority) {
        this.zoom = zoom;
        this.tileX = tileX;
        this.tileY = tileY;
        this.key = key;
        this.priority = priority;
    }
}
