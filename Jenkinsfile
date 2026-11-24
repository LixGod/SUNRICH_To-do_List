pipeline {
    agent any
    options { timestamps() }
    stages {
        stage('Backend tests') {
            steps { dir('backend') { sh './gradlew test --no-daemon' } }
        }
        stage('Frontend tests and build') {
            steps { dir('frontend') { sh 'npm ci && npm test && npm run build' } }
        }
        stage('Browser smoke test') {
            steps { dir('frontend') { sh 'npx playwright install --only-shell chromium && npm run test:e2e' } }
        }
        stage('Docker build') {
            steps {
                sh 'docker build -t sunrich-todo-backend:latest backend'
                sh 'docker build -t sunrich-todo-frontend:latest frontend'
            }
        }
        stage('Deploy') {
            when { branch 'main' }
            steps {
                sh '''
                    case "${APP_PUBLIC_URL:-}" in
                        https://*) ;;
                        *) echo 'Set APP_PUBLIC_URL to the deployed HTTPS URL and provision its reverse proxy before deploying.' >&2; exit 1 ;;
                    esac
                '''
                withCredentials([
                    string(credentialsId: 'sunrich-admin-email', variable: 'APP_ADMIN_USERNAME'),
                    string(credentialsId: 'sunrich-admin-password', variable: 'APP_ADMIN_PASSWORD'),
                    string(credentialsId: 'sunrich-db-password', variable: 'DB_PASSWORD'),
                    string(credentialsId: 'sunrich-mysql-root-password', variable: 'MYSQL_ROOT_PASSWORD')
                ]) {
                    sh 'docker compose up --no-build -d'
                }
                sh '''
                    curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --max-time 10 "${APP_PUBLIC_URL%/}/" > /dev/null
                    curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --max-time 10 "${APP_PUBLIC_URL%/}/api/auth/csrf" > /dev/null
                '''
            }
        }
    }
}
