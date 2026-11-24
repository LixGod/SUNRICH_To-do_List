package com.sunrich.todo

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.http.ResponseCookie
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.authentication.AnonymousAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.filter.OncePerRequestFilter
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.Base64

@Entity
@Table(name = "login_tokens")
class LoginToken(
    @Id @Column(length = 64) var tokenHash: String = "",
    @Column(nullable = false) var userId: Long = 0,
    @Column(nullable = false) var expiresAt: Instant = Instant.EPOCH
)

interface LoginTokenRepository : JpaRepository<LoginToken, String> {
    fun deleteByUserId(userId: Long)
    fun deleteByExpiresAtBefore(now: Instant)
}

@Service
class PersistentLogin(private val tokens: LoginTokenRepository, private val users: UserAccountRepository) {
    private val random = SecureRandom()
    private val lifetime = Duration.ofDays(30)
    private val cookieName = "SUNRICH_AUTH"

    @Transactional
    fun issue(user: UserAccount, request: HttpServletRequest, response: HttpServletResponse) {
        tokens.deleteByExpiresAtBefore(Instant.now())
        val value = ByteArray(32).also(random::nextBytes)
            .let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
        tokens.save(LoginToken(hash(value), user.id!!, Instant.now().plus(lifetime)))
        response.addHeader("Set-Cookie", cookie(value, request, lifetime))
    }

    fun authenticate(request: HttpServletRequest) = request.cookies
        ?.firstOrNull { it.name == cookieName }
        ?.value
        ?.let { tokens.findById(hash(it)).orElse(null) }
        ?.takeIf { it.expiresAt.isAfter(Instant.now()) }
        ?.let { users.findById(it.userId).orElse(null) }
        ?.let { user -> UsernamePasswordAuthenticationToken(user.username, null,
            user.roles.map { SimpleGrantedAuthority("ROLE_${it.name}") }) }

    @Transactional
    fun revoke(request: HttpServletRequest, response: HttpServletResponse) {
        request.cookies?.firstOrNull { it.name == cookieName }?.value
            ?.let { tokens.deleteById(hash(it)) }
        response.addHeader("Set-Cookie", cookie("", request, Duration.ZERO))
    }

    @Transactional
    fun revokeAll(userId: Long) = tokens.deleteByUserId(userId)

    private fun cookie(value: String, request: HttpServletRequest, age: Duration) =
        ResponseCookie.from(cookieName, value).httpOnly(true).secure(request.isSecure)
            .sameSite("Lax").path("/").maxAge(age).build().toString()

    private fun hash(value: String) = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

class PersistentLoginFilter(private val login: PersistentLogin) : OncePerRequestFilter() {
    override fun doFilterInternal(req: HttpServletRequest, res: HttpServletResponse, chain: FilterChain) {
        if (SecurityContextHolder.getContext().authentication == null ||
            SecurityContextHolder.getContext().authentication is AnonymousAuthenticationToken) {
            login.authenticate(req)?.let { SecurityContextHolder.getContext().authentication = it }
        }
        chain.doFilter(req, res)
    }
}
