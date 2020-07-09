package io.dockstore.wdlparser;

public class Response {
    private boolean isValid;

    public boolean isValid() {
        return isValid;
    }

    public void setValid(boolean valid) {
        isValid = valid;
    }

    public String getClonedRepositoryAbsolutePath() {
        return clonedRepositoryAbsolutePath;
    }

    public void setClonedRepositoryAbsolutePath(String clonedRepositoryAbsolutePath) {
        this.clonedRepositoryAbsolutePath = clonedRepositoryAbsolutePath;
    }

    private String clonedRepositoryAbsolutePath;
}
