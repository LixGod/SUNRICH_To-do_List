package com.sunrich.todo

import jakarta.persistence.*
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.Size
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.ApplicationRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpStatus
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.Authentication
import org.springframework.security.core.userdetails.User
import org.springframework.security.core.userdetails.UserDetailsService
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.session.SessionManagementFilter
import org.springframework.security.web.authentication.HttpStatusEntryPoint
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter
import org.springframework.security.web.csrf.CookieCsrfTokenRepository
import org.springframework.security.web.csrf.CsrfToken
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException
import org.springframework.stereotype.Service
import org.springframework.web.filter.OncePerRequestFilter
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.time.Duration
import java.time.Instant

@Service
class LoginAttemptLimiter {
    private data class Attempts(val count: Int, val until: Instant)
    private val failures = LinkedHashMap<String, Attempts>()
    private val window = Duration.ofMinutes(10)
    private fun key(username: String) = username.trim().lowercase().take(255)

    @Synchronized
    fun blocked(username: String): Boolean {
        val key = key(username)
        val attempts = failures[key] ?: return false
        if (Instant.now().isAfter(attempts.until)) {
            failures.remove(key)
            return false
        }
        return attempts.count >= 5
    }

    @Synchronized
    fun failed(username: String) {
        val key = key(username)
        val now = Instant.now()
        val old = failures[key]?.takeIf { now.isBefore(it.until) }
        failures[key] = Attempts((old?.count ?: 0) + 1, old?.until ?: now.plus(window))
        // Keep memory bounded if an attacker submits many different usernames.
        if (failures.size > 10_000) failures.remove(failures.keys.first())
    }

    @Synchronized
    fun succeeded(username: String) { failures.remove(key(username)) }
}

class LoginAttemptFilter(private val limiter: LoginAttemptLimiter) : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        if (request.method == "POST" && request.requestURI == request.contextPath + "/api/auth/login" &&
            limiter.blocked(request.getParameter("username") ?: "")) {
            response.status = HttpStatus.TOO_MANY_REQUESTS.value()
            return
        }
        chain.doFilter(request, response)
    }
}

enum class Role { SUPER_ADMIN, CHAIRMAN, VICE_PRESIDENT, MANAGING_DIRECTOR, DIRECTOR, ASSISTANT_VICE_PRESIDENT }

val SENIOR_MANAGEMENT_ROLES = setOf(
    Role.CHAIRMAN, Role.VICE_PRESIDENT, Role.MANAGING_DIRECTOR, Role.DIRECTOR, Role.ASSISTANT_VICE_PRESIDENT
)

// A valid account carries exactly one senior-management role, optionally plus SUPER_ADMIN; SUPER_ADMIN alone
// is reserved for the bootstrap administrator and is never produced through the admin create/update form.
fun validateRoles(roles: Set<Role>) {
    val senior = roles.intersect(SENIOR_MANAGEMENT_ROLES)
    if (senior.size != 1 || (roles - senior - Role.SUPER_ADMIN).isNotEmpty()) {
        throw ResponseStatusException(HttpStatus.BAD_REQUEST,
            "Pick exactly one senior management role; Super Admin may be added alongside it.")
    }
}

@Entity
@Table(name = "users", uniqueConstraints = [UniqueConstraint(columnNames = ["username"])])
class UserAccount(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null,
    @Column(nullable = false)
    var username: String = "",
    @Column(nullable = false)
    var displayName: String = "",
    @Column(nullable = false)
    var passwordHash: String = "",
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_roles", joinColumns = [JoinColumn(name = "user_id")])
    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    var roles: MutableSet<Role> = mutableSetOf()
)

fun UserAccount.isStaff() = roles.any { it in SENIOR_MANAGEMENT_ROLES }

interface UserAccountRepository : JpaRepository<UserAccount, Long> {
    fun findByUsername(username: String): UserAccount?
    fun existsByUsername(username: String): Boolean
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserAccount u where u.username = :username")
    fun lockByUsername(username: String): UserAccount?
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select u from UserAccount u where u.id = :id")
    fun lockById(id: Long): UserAccount?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserAccount u where u.id = :id")
    fun lockByIdForWrite(id: Long): UserAccount?
}

data class AccountView(val id: Long, val username: String, val displayName: String, val roles: Set<Role>)
fun UserAccount.view() = AccountView(id!!, username, displayName, roles)

@Configuration
class AuthConfig {
    @Bean
    fun passwordEncoder(): PasswordEncoder = BCryptPasswordEncoder()

    @Bean
    fun userDetailsService(users: UserAccountRepository): UserDetailsService = UserDetailsService { username ->
        val account = users.findByUsername(username.lowercase())
            ?: throw org.springframework.security.core.userdetails.UsernameNotFoundException("Invalid credentials")
        User.withUsername(account.username).password(account.passwordHash)
            .roles(*account.roles.map { it.name }.toTypedArray()).build()
    }

    @Bean
    fun securityFilterChain(http: HttpSecurity, users: UserAccountRepository, login: PersistentLogin,
                            limiter: LoginAttemptLimiter): SecurityFilterChain {
        http.sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        http.requestCache { it.disable() }
        http.csrf {
            it.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .csrfTokenRequestHandler(CsrfTokenRequestAttributeHandler())
        }
        http.authorizeHttpRequests {
            it.requestMatchers("/api/auth/csrf").permitAll()
                .requestMatchers("/api/auth/login").permitAll()
                .requestMatchers("/api/admin/**").hasRole("SUPER_ADMIN")
                .requestMatchers("/api/tasks/**").hasAnyRole(
                    *SENIOR_MANAGEMENT_ROLES.map { it.name }.toTypedArray())
                .anyRequest().authenticated()
        }
        http.formLogin {
            it.loginProcessingUrl("/api/auth/login")
                .successHandler { request, response, auth ->
                    limiter.succeeded(auth.name)
                    val account = users.findByUsername(auth.name)!!
                    login.issue(account, request, response)
                    response.status = HttpStatus.NO_CONTENT.value()
                }
                .failureHandler { request, response, _ ->
                    limiter.failed(request.getParameter("username") ?: "")
                    response.status = HttpStatus.UNAUTHORIZED.value()
                }
                .permitAll()
        }
        http.logout {
            it.logoutUrl("/api/auth/logout")
                .logoutSuccessHandler { request, response, _ ->
                    login.revoke(request, response)
                    response.status = HttpStatus.NO_CONTENT.value()
                }
        }
        http.exceptionHandling { it.authenticationEntryPoint(HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)) }
        http.addFilterAfter(PersistentLoginFilter(login), SessionManagementFilter::class.java)
        http.addFilterBefore(LoginAttemptFilter(limiter), UsernamePasswordAuthenticationFilter::class.java)
        return http.build()
    }

    @Bean
    fun bootstrapAdmin(
        users: UserAccountRepository,
        encoder: PasswordEncoder,
        @Value("\${APP_ADMIN_USERNAME:}") username: String,
        @Value("\${APP_ADMIN_PASSWORD:}") password: String,
        @Value("\${APP_ADMIN_NAME:Super Admin}") name: String
    ) = ApplicationRunner {
        if (users.count() == 0L) {
            require(username.isNotBlank() && password.length >= 8) {
                "Set APP_ADMIN_USERNAME and APP_ADMIN_PASSWORD (at least 8 characters) for the initial administrator."
            }
            users.save(UserAccount(username = username.trim().lowercase(), displayName = name.trim(),
                passwordHash = encoder.encode(password), roles = mutableSetOf(Role.SUPER_ADMIN)))
        }
    }
}

data class PasswordChangeRequest(
    @field:NotBlank val currentPassword: String,
    @field:Size(min = 8) val newPassword: String
)

data class ProfileUpdateRequest(@field:NotBlank @field:Size(max = 255) val displayName: String)

@RestController
@RequestMapping("/api/auth")
class AuthController(private val users: UserAccountRepository, private val encoder: PasswordEncoder,
                     private val login: PersistentLogin) {
    @GetMapping("/csrf")
    fun csrf(token: CsrfToken): Map<String, String> = mapOf("token" to token.token)

    @GetMapping("/me")
    fun me(auth: Authentication): AccountView = account(auth).view()

    @PutMapping("/profile")
    @Transactional
    fun updateProfile(auth: Authentication, @Valid @RequestBody body: ProfileUpdateRequest): AccountView {
        val user = lockedAccount(auth)
        user.displayName = body.displayName.trim()
        return users.save(user).view()
    }

    @PostMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    fun changePassword(auth: Authentication, @Valid @RequestBody body: PasswordChangeRequest) {
        val user = lockedAccount(auth)
        if (!encoder.matches(body.currentPassword, user.passwordHash)) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Current password is incorrect.")
        }
        user.passwordHash = encoder.encode(body.newPassword)
        users.save(user)
        login.revokeAll(user.id!!)
    }

    private fun account(auth: Authentication) = users.findByUsername(auth.name)
        ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Account is no longer available.")

    private fun lockedAccount(auth: Authentication) = users.lockByUsername(auth.name)
        ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "Account is no longer available.")
}

data class UserCreateRequest(
    @field:NotBlank @field:Size(max = 255) val username: String,
    @field:NotBlank @field:Size(max = 255) val displayName: String,
    @field:Size(min = 8) val password: String,
    @field:NotEmpty val roles: Set<Role> = emptySet()
)

data class UserUpdateRequest(
    @field:NotBlank @field:Size(max = 255) val username: String,
    @field:NotBlank @field:Size(max = 255) val displayName: String,
    @field:NotEmpty val roles: Set<Role> = emptySet(),
    val password: String? = null
)

@RestController
@RequestMapping("/api/admin/users")
class AdminController(
    private val users: UserAccountRepository,
    private val tasks: TaskRepository,
    private val encoder: PasswordEncoder,
    private val login: PersistentLogin
) {
    @GetMapping
    fun list(): List<AccountView> =
        users.findAll().filter { it.isStaff() }.sortedBy { it.username }.map { it.view() }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@Valid @RequestBody body: UserCreateRequest): AccountView {
        validateRoles(body.roles)
        val username = body.username.trim().lowercase()
        if (users.existsByUsername(username)) throw ResponseStatusException(HttpStatus.CONFLICT, "Account already exists.")
        return saveAccount(UserAccount(username = username, displayName = body.displayName.trim(),
            passwordHash = encoder.encode(body.password), roles = body.roles.toMutableSet()))
    }

    @PutMapping("/{id}")
    @Transactional
    fun update(@PathVariable id: Long, @Valid @RequestBody body: UserUpdateRequest): AccountView {
        validateRoles(body.roles)
        val user = lockedStaff(id)
        val username = body.username.trim().lowercase()
        val revokeLogin = username != user.username || body.roles != user.roles || body.password != null
        if (username != user.username) {
            if (users.existsByUsername(username)) throw ResponseStatusException(HttpStatus.CONFLICT, "Account already exists.")
            tasks.moveUserTasks(user.username, username)
            user.username = username
        }
        user.displayName = body.displayName.trim()
        user.roles = body.roles.toMutableSet()
        if (body.password != null) {
            if (body.password.length < 8) throw ResponseStatusException(HttpStatus.BAD_REQUEST, "Password needs at least 8 characters.")
            user.passwordHash = encoder.encode(body.password)
        }
        val saved = saveAccount(user)
        if (revokeLogin) login.revokeAll(id)
        return saved
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    fun delete(@PathVariable id: Long) {
        val user = lockedStaff(id)
        login.revokeAll(id)
        tasks.lockAllByUserId(user.username).forEach { task ->
            val recipient = task.recipientId?.let { users.findById(it).orElse(null) }
            if (recipient != null && recipient.id != user.id) {
                task.userId = recipient.username
                tasks.save(task)
            } else tasks.delete(task)
        }
        tasks.clearRecipient(id)
        users.delete(user)
    }

    private fun lockedStaff(id: Long): UserAccount {
        val username = staff(id).username
        return users.lockByUsername(username)?.takeIf { it.id == id && it.isStaff() }
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found.")
    }

    private fun saveAccount(user: UserAccount): AccountView = try {
        users.saveAndFlush(user).view()
    } catch (e: DataIntegrityViolationException) {
        throw ResponseStatusException(HttpStatus.CONFLICT, "Account already exists.", e)
    }

    private fun staff(id: Long) = users.findById(id).orElse(null)?.takeIf { it.isStaff() }
        ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found.")
}
