package com.example.gnsssatdemo;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.UriMatcher;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

public class ExportShareProvider extends ContentProvider {
    private static final String PATH_EXPORT = "export";
    private static final int MATCH_EXPORT_FILE = 1;

    private UriMatcher matcher;

    @Override
    public boolean onCreate() {
        matcher = new UriMatcher(UriMatcher.NO_MATCH);
        matcher.addURI(authority(), PATH_EXPORT + "/*", MATCH_EXPORT_FILE);
        return true;
    }

    @Override
    public String getType(Uri uri) {
        if (matcher.match(uri) != MATCH_EXPORT_FILE) {
            return null;
        }
        String extension = MimeTypeMap.getFileExtensionFromUrl(uri.toString());
        if ("gpx".equalsIgnoreCase(extension)) {
            return "application/gpx+xml";
        }
        if ("jsonl".equalsIgnoreCase(extension)) {
            return "application/json";
        }
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return type == null ? "application/octet-stream" : type;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File file;
        try {
            file = fileForUri(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] columns = projection == null
                ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
                : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) {
                row.add(file.getName());
            } else if (OpenableColumns.SIZE.equals(column)) {
                row.add(file.length());
            } else {
                row.add(null);
            }
        }
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!TextUtils.equals(mode, "r")) {
            throw new FileNotFoundException("只允许读取分享文件");
        }
        return ParcelFileDescriptor.open(fileForUri(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("只读分享 Provider");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("只读分享 Provider");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("只读分享 Provider");
    }

    private File fileForUri(Uri uri) throws FileNotFoundException {
        if (matcher.match(uri) != MATCH_EXPORT_FILE || getContext() == null) {
            throw new FileNotFoundException("未知分享文件: " + uri);
        }
        String encodedName = uri.getLastPathSegment();
        if (encodedName == null || encodedName.contains("/") || encodedName.contains("..")) {
            throw new FileNotFoundException("非法分享文件名: " + uri);
        }
        File exportDir = shareDir();
        try {
            File file = new File(exportDir, encodedName).getCanonicalFile();
            if (!exportDir.getCanonicalFile().equals(file.getParentFile()) || !file.isFile()) {
                throw new FileNotFoundException("分享文件不存在: " + uri);
            }
            return file;
        } catch (IOException e) {
            FileNotFoundException wrapped = new FileNotFoundException(e.getMessage());
            wrapped.initCause(e);
            throw wrapped;
        }
    }

    private File shareDir() {
        return new File(getContext().getCacheDir(), "shared_exports");
    }

    private String authority() {
        return getContext().getPackageName() + ".exportshare";
    }
}
